"""MCP-executed quadruped donor sampling, target IK bake, and staged export.

Call run(stage, animal) through tools/blender/mcp_client.py. Never substitutes a
renamed clip: every output is sampled from donor pose/foot motion then keyframed
on the existing target armature. Runtime geometry is merged by animal_glb.mjs.
"""
from pathlib import Path
import bpy
import hashlib
import json
import math
import sys
import os
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
from animal_trajectory import contact_window,foot_trajectory
from mathutils import Matrix, Vector, Quaternion

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/mount-retarget"
# The mesh joins the front legs below 0.27 m and the rear legs below 0.38 m.
# Adapt the donor excursion to that clearance; a generic long-leg crouch/lift
# combination pulls these short limbs into the belly even with smooth weights.
CORGI_GAIT = {
    "walk": {"stride": {"front": .22, "rear": .22}, "lift": {"front": .035, "rear": .035}},
    "run": {"stride": {"front": .30, "rear": .34}, "lift": {"front": .045, "rear": .04}},
}
SPECIES = {
    "black-cat": {"rig": "black_cat_rig", "prefix": "cat", "run": "cat_run", "duration": {"idle":10.0,"walk":1.2,"run":.8,"death":1.8}},
    "corgi": {"rig":"corgi_rig","prefix":"corgi","run":"corgi_run","duration":{"idle":10.0,"walk":1.2,"run":.8,"death":1.8}},
}
DONORS = {
    "doginx_idle": ("doginx__Armature", "doginx__Armature|Armature|Idle", 1.0,301.0,24.0),
    "doginx_walk": ("doginx__Armature", "doginx__Armature|Armature|Walking", 1.0,29.0,24.0),
    "cat_run": ("cat_run__Armature","cat_run__Armature|Armature|ArmatureAction",1.0,37.0,24.0),
    "corgi_run": ("corgi_run__Armature","corgi_run__Run",10.0,28.0,24.0),
}
MAPPING = {
    "doginx": {"torso":"Animal","chest":"Body","neck":"Head","head":"Head","tail_0":"Tail"},
    "cat_run": {"torso":"pelvis","chest":"body_2","neck":"neck","head":"head",**{"tail_"+str(i):"tail_"+str(min(i+1,4)) for i in range(5)}},
    "corgi_run": {"torso":"Bone","chest":"Bone.005","neck":"Bone.002","head":"Bone.003","tail_0":"Bone.001"},
}
FOOT_MAP = {
    "doginx": {(end,s):("Foot."+("Front"if end=="front"else"Back")+"."+s.upper(),"head")for end in ["front","rear"]for s in ["l","r"]},
    "cat_run": {(end,s):("leg_"+("front"if end=="front"else"back")+"_"+("left"if s=="l"else"right")+"_4","head")for end in ["front","rear"]for s in ["l","r"]},
    "corgi_run": {("front","l"):("Bone.002_L.001","tail"),("front","r"):("Bone.002_R.001","tail"),("rear","l"):("Bone_L.001","tail"),("rear","r"):("Bone_R.001","tail")},
}

LOCAL_SOURCES={
 "cat_run":{"file":"cat_rigged.fbx","sha256":"e1386997828c40e21b1923b7763b118127a46adacd248457789d520492c69792"},
 "doginx":{"file":"Doginx fbx + unity.zip","sha256":"87a0e0beaa0b3ccae02ba8d4f5ab7e8ed6daece218548beff1e33996aefc0205","member":"Models/Meshes/characters.fbx","extract":"doginx.fbx"},
 "corgi_run":{"file":"dog-corgi-animated.zip","sha256":"ae44ef517f4610a174934a786f3e58e37c4fc7a1e287f1eeb46cf9db574d14ae","member":"source/Корги_bake.blend","extract":"corgi-donor.blend"},
}

def import_donors():
    directory=Path(os.environ.get("SAGABURST_ANIMATION_DONOR_DIR",str(Path.home()/"Downloads")))
    extracted=OUT/"donors";extracted.mkdir(parents=True,exist_ok=True);records={}
    for key,spec in LOCAL_SOURCES.items():
        source=directory/spec["file"];raw=source.read_bytes();digest=hashlib.sha256(raw).hexdigest()
        assert digest==spec["sha256"],"Changed donor archive/file: "+str(source)
        path=source
        if "member"in spec:
            with zipfile.ZipFile(source)as archive:
                data=archive.read(spec["member"])
            path=extracted/spec["extract"];path.write_bytes(data)
        records[key]={"file":spec["file"],"sha256":digest,"member":spec.get("member"),"extractedSha256":hashlib.sha256(path.read_bytes()).hexdigest()}
        if bpy.data.objects.get(key+"__Armature"):continue
        before=set(bpy.data.objects);before_actions=set(bpy.data.actions)
        if path.suffix==".fbx":
            bpy.ops.import_scene.fbx(filepath=str(path),use_anim=True,ignore_leaf_bones=True)
            objects=list(set(bpy.data.objects)-before);actions=list(set(bpy.data.actions)-before_actions)
        else:
            with bpy.data.libraries.load(str(path),link=False)as(original,loaded):loaded.objects=original.objects;loaded.actions=original.actions
            objects=loaded.objects;actions=loaded.actions
            for o in objects:bpy.context.scene.collection.objects.link(o)
        for o in objects:
            o.name=key+"__"+o.name;o.hide_set(True);o.hide_render=True
        for action in actions:action.name=key+"__"+action.name;action.use_fake_user=True
        rig=next(o for o in objects if o.type=="ARMATURE");select_action(rig,None)
        records[key]["rig"]=rig.name;records[key]["actions"]=[{"name":a.name,"frames":list(a.frame_range)}for a in actions]
    (OUT/"donor-import.json").write_text(json.dumps(records,indent=2))
    print(json.dumps(records))

def select_action(rig,action):
    rig.animation_data_create()
    for track in rig.animation_data.nla_tracks:track.mute=True
    rig.animation_data.action=action
    if action and len(action.slots):rig.animation_data.action_slot=action.slots[0]

def update(frame):
    bpy.context.scene.frame_set(math.floor(frame),subframe=frame%1)
    bpy.context.view_layer.update()

def prepare_targets():
    values=[i.identifier for i in bpy.ops.import_scene.gltf.get_rna_type().properties["bone_heuristic"].enum_items]
    assert "BLENDER" in values
    for animal,spec in SPECIES.items():
        rig=bpy.data.objects.get(spec["rig"])
        if rig:
            actions=[a for a in bpy.data.actions if a.name.startswith("baseline_"+animal+"__")]
        else:
            before=set(bpy.data.actions)
            bpy.ops.import_scene.gltf(filepath=str(OUT/(animal+"-input.glb")),bone_heuristic="BLENDER")
            rig=bpy.data.objects[spec["rig"]]
            actions=list(set(bpy.data.actions)-before)
        idle=next(a for a in actions if a.name.split("|")[-1]=="idle"or a.name.endswith("__idle"))
        if animal=="corgi":
            # The canonical input already has reviewed wrist/hock bind pivots.
            # Old-basis baseline idle channels must not define its target axes.
            import runpy
            runpy.run_path(str(ROOT/"tools/blender/corgi_rig.py"))["target_reference"](rig)
        else:
            select_action(rig,idle);update(float(idle.frame_range[0]))
            reference={p.name:{"basis":[list(r)for r in p.matrix_basis],"worldRotation":list(p.matrix.to_quaternion()),"head":list(p.head),"tail":list(p.tail),"restRotation":list(p.bone.matrix_local.to_quaternion())}for p in rig.pose.bones}
            (OUT/(animal+"-reference.json")).write_text(json.dumps(reference,indent=2))
            (OUT/(animal+"-reference-metadata.json")).write_text(json.dumps({"action":idle.name,"sourceFrame":float(idle.frame_range[0]),"reference":"baseline idle first evaluated frame","boneHeuristic":"BLENDER","boneCount":len(reference)},indent=2))
        for a in actions:
            if not a.name.startswith("baseline_"):a.name="baseline_"+animal+"__"+a.name
        select_action(rig,None)
        for o in rig.children:
            if o.type=="MESH"and any(o.name.endswith("lod"+str(i))for i in [1,2]):o.hide_set(True);o.hide_render=True
        rig.hide_set(True)
    print(json.dumps({"targets":list(SPECIES),"reference":"original idle first frame; immutable target bind axes"}))

def sample_donor(key):
    rig_name,action_name,start,end,fps=DONORS[key]
    rig=bpy.data.objects[rig_name];select_action(rig,bpy.data.actions[action_name])
    alignment=Quaternion((0,0,1),-math.pi/2)if key=="cat_run"else Quaternion()
    matrix=alignment.to_matrix().to_4x4()@rig.matrix_world
    result={"action":action_name,"sourceFrames":[start,end],"sourceFps":fps,"originalSeconds":(end-start)/fps,"alignmentQuaternion":list(alignment),"rest":{},"poses":[]}
    for b in rig.data.bones:result["rest"][b.name]={"head":list(matrix@b.head_local),"tail":list(matrix@b.tail_local),"rotation":list((matrix@b.matrix_local).to_quaternion())}
    for i in range(121):
        f=start+(end-start)*i/120;update(f)
        result["poses"].append({p.name:{"head":list(matrix@p.head),"tail":list(matrix@p.tail),"rotation":list((matrix@p.matrix).to_quaternion())}for p in rig.pose.bones})
    (OUT/(key+"-samples.json")).write_text(json.dumps(result))
    return {"donor":key,"sourceFrames":[start,end],"sourceFps":fps,"samples":121}

def source_at(source,phase,bone,property="head"):
    x=max(0,min(1,phase))*120;i=min(119,int(x));w=x-i
    a=source["poses"][i][bone][property];b=source["poses"][i+1][bone][property]
    value=Quaternion(a).slerp(Quaternion(b),w)if property=="rotation"else Vector(a).lerp(Vector(b),w)
    if phase>.92 and source["action"].startswith("corgi_run__"):
        t=(phase-.92)/.08;t=t*t*(3-2*t);first=source["poses"][0][bone][property]
        value=value.slerp(Quaternion(first),t)if property=="rotation"else value.lerp(Vector(first),t)
    return value

def apply_world_rotation(rig,bone,desired,world):
    p=rig.pose.bones[bone]
    parent=p.parent
    if parent:
        parent_pose=world.get(parent.name,parent.matrix.to_quaternion())
        rest_local=parent.bone.matrix_local.to_quaternion().inverted()@p.bone.matrix_local.to_quaternion()
        p.rotation_quaternion=(parent_pose@rest_local).inverted()@desired
    else:p.rotation_quaternion=p.bone.matrix_local.to_quaternion().inverted()@desired
    p.rotation_quaternion.normalize();world[bone]=desired

def two_bone_positions(root,target,l1,l2,pole):
    requested=target.copy();direction=target-root;distance=direction.length
    distance=max(abs(l1-l2)+.0001,min(distance,(l1+l2)*.9999))
    direction.normalize();target=root+direction*distance
    along=(l1*l1-l2*l2+distance*distance)/(2*distance)
    offset=math.sqrt(max(0,l1*l1-along*along))
    bend=pole-direction*pole.dot(direction)
    if bend.length<.000001:bend=Vector((0,1,0))
    bend.normalize();knee=root+direction*along+bend*offset
    return [root,knee,target],(target-requested).length

def solve_chain(rig,names,target,reference,world,source,family,phase,lift):
    current=[rig.pose.bones[n].head.copy()for n in names]
    lengths=[(Vector(reference[names[i+1]]["head"])-Vector(reference[names[i]]["head"])).length for i in range(len(names)-1)]
    requested=target.copy();side="l"if names[0].endswith("_l")else"r"
    parent=rig.pose.bones[names[0]].parent
    body_delta=parent.matrix.to_quaternion()@Quaternion(reference[parent.name]["worldRotation"]).inverted()
    def upper_down(points):
        v=body_delta.inverted()@(points[1]-points[0]);return -v.z/v.length
    def proximal_allowed(points):
        v=body_delta.inverted()@(points[1]-points[0])
        inward=v.y<0 if len(names)==4 else v.y>0
        return upper_down(points)>=math.cos(math.radians(85))and(not inward or upper_down(points)>=minimum_down)
    floor_z=reference[names[-1]]["head"][2]
    minimum_down=math.cos(math.radians(65 if len(names)==4 else 50))
    if len(names)==4:
        # The metatarsal follows the actual donor's downward direction. Solving
        # the hock first prevents free 3-link FABRIK from folding this last
        # segment upward and picking a non-anatomical hock branch in flight.
        if family=="cat_run":
            donor="leg_back_"+("left"if side=="l"else"right")+"_3"
            segment=source_at(source,phase,donor,"tail")-source_at(source,phase,donor,"head")
        elif family=="corgi_run":
            donor="Bone_"+side.upper()+".001"
            segment=source_at(source,phase,donor,"tail")-source_at(source,phase,donor,"head")
        else:segment=Vector(reference[names[-1]]["head"])-Vector(reference[names[-2]]["head"])
        segment.x=0;segment.normalize()
        preferred=max(-1.05,min(1.05,math.atan2(segment.y,-segment.z)))
        ref_shin=Vector(reference[names[2]]["head"])-Vector(reference[names[1]]["head"])
        ref_meta=Vector(reference[names[3]]["head"])-Vector(reference[names[2]]["head"])
        expected_sign=1 if ref_shin.y*ref_meta.z-ref_shin.z*ref_meta.y>0 else -1
        for attempt in range(120):
            candidates=[]
            for angle in [preferred]+[-1.05+i*2.1/80 for i in range(81)]:
                candidate=Vector((0,math.sin(angle),-math.cos(angle)))
                hock=target-candidate*lengths[2]
                joints,reach=two_bone_positions(current[0],hock,lengths[0],lengths[1],Vector((0,-1,0)))
                shin=joints[2]-joints[1];cross=shin.y*candidate.z-shin.z*candidate.y;interior=math.pi-shin.angle(candidate)
                if cross*expected_sign>.000001 and math.radians(45)<interior<math.radians(165) and proximal_allowed(joints):
                    donor_upper=None
                    if family=="cat_run":
                        source_upper="leg_back_"+("left"if side=="l"else"right")+"_1"
                        donor_upper=source_at(source,phase,source_upper,"tail")-source_at(source,phase,source_upper,"head");donor_upper.x=0;donor_upper.normalize()
                    direction_cost=(1-donor_upper.dot((joints[1]-joints[0]).normalized()))if donor_upper else 0
                    candidates.append((abs(angle-preferred)+reach*50+direction_cost*(2 if lift>.1 else .2),joints,reach,candidate,interior,cross))
            if candidates:break
            if lift<=.00001:raise ValueError("Unreachable planted proximal envelope for "+names[0]+" phase="+str(phase))
            # Adapt flight only: keep the thigh directed out of the body bulk.
            # Lower lift first, then reduce forward recovery if still necessary.
            if target.z>floor_z+.025+(1e-5 if names[0].startswith("corgi_")else 0):target.z=max(floor_z+.025,target.z-.025)
            else:target.y+=.015
        if not candidates:raise ValueError("No anatomical proximal/hock branch for "+names[0])
        _,points,clamp,segment,interior,cross=min(candidates,key=lambda v:v[0]);points.append(points[-1]+segment*lengths[2])
    else:
        for attempt in range(120):
            points,clamp=two_bone_positions(current[0],target,lengths[0],lengths[1],Vector((0,1,0)))
            if proximal_allowed(points):break
            if lift<=.00001:raise ValueError("Unreachable planted proximal envelope for "+names[0]+" phase="+str(phase))
            if target.z>floor_z+.025+(1e-5 if names[0].startswith("corgi_")else 0):target.z=max(floor_z+.025,target.z-.025)
            else:target.y-=.015
        else:raise ValueError("No front proximal envelope for "+names[0])
    for i,name in enumerate(names[:-1]):
        original=Vector(reference[names[i+1]]["head"])-Vector(reference[name]["head"])
        desired=original.rotation_difference(points[i+1]-points[i])@Quaternion(reference[name]["worldRotation"])
        apply_world_rotation(rig,name,desired,world)
    paw_rotation=Quaternion(reference[names[-1]]["worldRotation"])
    if lift>.03 and family=="cat_run":
        donor="leg_"+("back"if len(names)==4 else"front")+"_"+("left"if side=="l"else"right")+"_4"
        toe=source_at(source,phase,donor,"tail")-source_at(source,phase,donor,"head")
        # Contact soles stay level; flight gets bounded donor toe articulation.
        if len(names)==3:
            label="left"if side=="l"else"right"
            source_lower=source_at(source,phase,"leg_front_"+label+"_4")-source_at(source,phase,"leg_front_"+label+"_2")
            relative=math.atan2(source_lower.y*toe.z-source_lower.z*toe.y,source_lower.y*toe.y+source_lower.z*toe.z)
            relative=max(-math.radians(40),min(math.radians(40),relative))
            lower=points[-1]-points[-2];angle=math.atan2(lower.y,-lower.z)+relative
            desired_axis=Vector((0,math.sin(angle),-math.cos(angle)))
            reference_axis=paw_rotation@Vector((0,1,0))
            desired=reference_axis.rotation_difference(desired_axis)@paw_rotation
            paw_rotation=paw_rotation.slerp(desired,min(1,lift/.12))
        else:
            pitch=max(-.30,min(.30,math.atan2(toe.z,-toe.y)))
            paw_rotation=Quaternion((1,0,0),-pitch*min(1,lift/.15))@paw_rotation
    apply_world_rotation(rig,names[-1],paw_rotation,world)
    return {"requestedError":(points[-1]-requested).length,"clampDistance":clamp,"effectiveTarget":target.copy(),"flightAdaptationM":(target-requested).length,"upperDown":upper_down(points)}

def donor_flight_target(rig,names,reference,source,phase,end,side):
    label="left"if side=="l"else"right";tag="front"if end=="front"else"back"
    bones=["leg_"+tag+"_"+label+"_"+str(i)for i in [1,2,3,4]]
    points=[source_at(source,phase,n)for n in bones]
    source_length=sum((points[i+1]-points[i]).length for i in range(3))
    target_length=sum((Vector(reference[names[i+1]]["head"])-Vector(reference[names[i]]["head"])).length for i in range(len(names)-1))
    root=rig.pose.bones[names[0]].head.copy();v=(points[-1]-points[0])*target_length/source_length;v.x=0
    if end=="front":
        # Preserve the source's shared extended suspension peak, adapting its
        # pitch so the longer target foreleg stretches near shoulder height.
        spans=[]
        for pose in source["poses"]:
            spans.append(sum(pose["leg_back_"+s+"_4"]["head"][1]-pose["leg_front_"+s+"_4"]["head"][1]for s in ["left","right"])/2)
        span=sum(source_at(source,phase,"leg_back_"+s+"_4").y-source_at(source,phase,"leg_front_"+s+"_4").y for s in ["left","right"])/2
        extension=max(0,min(1,(span-min(spans))/(max(spans)-min(spans))))
        extension=max(0,min(1,(extension-.65)/.35));extension=extension*extension*(3-2*extension)
        angle=math.atan2(v.y,-v.z);desired_angle=angle*(1-extension)-math.radians(73)*extension
        reach=min(target_length*.975,v.length)
        v=Vector((0,math.sin(desired_angle)*reach,-math.cos(desired_angle)*reach))
        v.y=min(v.y,.28) # recovery must clear the breast/abdomen
    desired=root+v;desired.x=reference[names[-1]]["head"][0]
    desired.z=max(reference[names[-1]]["head"][2]+.04,desired.z)
    return desired

def foot_curves(source,family,reference,prefix,end,side,clip):
    donor,point=FOOT_MAP[family][end,side]
    values=[Vector(p[donor][point])for p in source["poses"]]
    y=[v.y for v in values];z=[v.z for v in values]
    # Preserve donor phase and timing, adapting its displacement to the target
    # dimensions. Normalised lift allows the short-legged corgi source to run
    # as a large mount without exporting donor scales or stretching target legs.
    center,duty=contact_window([(v.y,v.z)for v in values])
    return {"donor":donor,"point":point,"yMin":min(y),"yMax":max(y),"zMin":min(z),"zMax":max(z),"center":sum(y)/len(y),"contactCenter":center,"sourceContactDuty":duty,"rest":source["rest"][donor][point]}

def bake(animal,clips=None):
    spec=SPECIES[animal];prefix=spec["prefix"];rig=bpy.data.objects[spec["rig"]]
    reference=json.loads((OUT/(animal+"-reference.json")).read_text())
    fps=60;bpy.context.scene.render.fps=fps
    report={"animal":animal,"rig":rig.name,"method":"evaluated donor world rotations and donor foot trajectories -> anatomical target IK -> sampled target Action","forward":"+Z","bakeFps":fps,"reference":json.loads((OUT/(animal+"-reference-metadata.json")).read_text()),"mapping":{},"clips":{}}
    previous=OUT/(animal+"-bake-report.json")
    if previous.exists():
        prior=json.loads(previous.read_text())
        report["clips"].update(prior["clips"])
        report["mapping"].update(prior.get("mapping",{}))
    for clip in clips or ["idle","walk","run","death"]:
        donor_key="doginx_"+clip if clip in ["idle","walk"]else spec["run"]
        family="doginx"if clip in ["idle","walk"]else spec["run"]
        source=json.loads((OUT/(donor_key+"-samples.json")).read_text())
        report["mapping"][clip]="authored target-only collapse"if clip=="death"else {prefix+"_"+role:bone for role,bone in MAPPING[family].items()}
        duration=spec["duration"][clip];count=round(duration*fps)
        old=bpy.data.actions.get(animal+"__"+clip)
        if old:bpy.data.actions.remove(old)
        action=bpy.data.actions.new(animal+"__"+clip);select_action(rig,action);action.use_fake_user=True
        curves={(end,s):foot_curves(source,family,reference,prefix,end,s,clip)for end in ["front","rear"]for s in ["l","r"]}
        frames=[];max_ik_error=0;max_requested_error=0;max_clamp=0;hock_audit=[];actual_targets=[];upper_audit=[];max_flight_adaptation=0
        for index in range(count+1):
            phase=index/count;frame=index+1;update(frame)
            for p in rig.pose.bones:
                p.rotation_mode="QUATERNION";p.matrix_basis=Matrix(reference[p.name]["basis"])
            bpy.context.view_layer.update();world={};requested_targets={}
            if clip!="death":
                for role,bone in MAPPING[family].items():
                    name=prefix+"_"+role
                    if name not in reference:continue
                    q=source_at(source,phase,bone,"rotation")@source_at(source,0,bone,"rotation").inverted()
                    gain=.35 if role in ["neck","head"]else .25 if role.startswith("tail")else .32
                    delta=Quaternion().slerp(q,gain)
                    apply_world_rotation(rig,name,delta@Quaternion(reference[name]["worldRotation"]),world)
                torso=rig.pose.bones[prefix+"_torso"]
                if clip in ["walk","run"]:
                    # Relative body bounce is adapted in metres; X/+Z drift is removed.
                    donor_root=MAPPING[family]["torso"]
                    dz=source_at(source,phase,donor_root).z-source_at(source,0,donor_root).z
                    height_scale=3.5 if animal=="black-cat"else 3.0
                    crouch=(.09 if clip=="walk"else .08)if animal=="black-cat"else 0.0
                    if animal=="corgi"and clip=="run":
                        # Centre the short-legged donor's body bounce. Its
                        # first frame is near the source apex; subtracting that
                        # frame kept the mount belly crouched through the cycle.
                        heights=[pose[donor_root]["head"][2]for pose in source["poses"]]
                        z=source_at(source,phase,donor_root).z
                        bounce=.025*(2*(z-min(heights))/max(max(heights)-min(heights),1e-8)-1)
                    else:bounce=max(-.10,min(.10,dz*height_scale))
                    torso.location=torso.bone.matrix_local.to_quaternion().inverted()@Vector((0,0,bounce-crouch))
                bpy.context.view_layer.update()
                for end in ["front","rear"]:
                    for side in ["l","r"]:
                        paw=prefix+"_"+end+"_paw_"+side
                        foot=curves[end,side];v=source_at(source,phase,foot["donor"],foot["point"])
                        target=Vector(reference[paw]["head"])
                        lift=0
                        if clip=="idle":
                            pass # The huge mount rests on planted feet; donor body/head/tail idle remain.
                        else:
                            stride=((.70 if end=="front"else .90)if clip=="run"else .65)if animal=="black-cat"else CORGI_GAIT[clip]["stride"][end]
                            speed=(13.2 if animal=="black-cat"else 12.0)if clip=="run"else 2.0
                            displacement,lift,foot_phase,contact,duty=foot_trajectory(phase,foot,stride,speed,duration,lambda t:source_at(source,t,foot["donor"],foot["point"]),clamp_swing=(animal=="corgi"))
                            target.y+=displacement
                            if clip=="run"and animal=="black-cat":target.y+=(.12 if end=="front"else .10)
                            lift_height=((.18 if end=="front"else .14)if clip=="run"else .12)if animal=="black-cat"else CORGI_GAIT[clip]["lift"][end]
                            target.z+=max(0,lift)*lift_height
                        names=[prefix+"_"+end+"_upper_"+side,prefix+"_"+end+"_lower_"+side]
                        if end=="rear":names.append(prefix+"_rear_ankle_"+side)
                        names.append(paw)
                        if clip=="run"and animal=="black-cat":
                            c=foot["contactCenter"];distance=abs((phase-c+.5)%1-.5)-duty/2
                            fk_weight=max(0,min(1,distance/.065));fk_weight=fk_weight*fk_weight*(3-2*fk_weight)
                            flight=donor_flight_target(rig,names,reference,source,phase,end,side)
                            target=target.lerp(flight,fk_weight);lift=max(lift,fk_weight);foot_phase=phase
                        solution=solve_chain(rig,names,target,reference,world,source,family,foot_phase if clip!="idle"else phase,lift)
                        requested_targets[end+"_"+side]=solution["effectiveTarget"]
                        max_clamp=max(max_clamp,solution["clampDistance"]);max_flight_adaptation=max(max_flight_adaptation,solution["flightAdaptationM"])
                        upper_audit.append({"phase":phase,"limb":end+"_"+side,"minimumDown":math.cos(math.radians(65 if end=="rear"else 50)),"actualDown":solution["upperDown"]})
            else:
                t=max(0,min(1,(phase-.12)/.60));a=t*t*(3-2*t)
                torso_name=prefix+"_torso";torso=rig.pose.bones[torso_name]
                # At 90 degrees the Corgi's rigid stirrup supports the corpse
                # 19 cm above its flank. A measured 70-degree collapse rests
                # the body on the floor while retaining tack clearance.
                roll=math.pi/2 if animal=="black-cat"else math.radians(70)
                apply_world_rotation(rig,torso_name,Quaternion((0,1,0),a*roll)@Quaternion(reference[torso_name]["worldRotation"]),world)
                drop=.64 if animal=="black-cat"else .41
                torso.location=torso.bone.matrix_local.to_quaternion().inverted()@Vector((0,0,-drop*a))
                for side in ["l","r"]:
                    for end in ["front","rear"]:
                        name=prefix+"_"+end+"_upper_"+side
                        rig.pose.bones[name].rotation_quaternion@=Quaternion((1,0,0),.3*a)
            bpy.context.view_layer.update()
            for key,target in requested_targets.items():
                actual=rig.pose.bones[prefix+"_"+key.split("_")[0]+"_paw_"+key[-1]].head.copy()
                error=(actual-target).length;max_requested_error=max(max_requested_error,error)
                actual_targets.append({"phase":phase,"foot":key,"requested":list(target),"actual":list(actual),"error":error})
            for p in rig.pose.bones:
                p.keyframe_insert("rotation_quaternion",frame=frame,group=p.name)
                p.keyframe_insert("location",frame=frame,group=p.name)
            if clip!="death":
                for side in ["l","r"]:
                    points=[rig.pose.bones[prefix+"_rear_"+tag+"_"+side].head.copy()for tag in ["upper","lower","ankle","paw"]]
                    shin=points[2]-points[1];meta=points[3]-points[2]
                    hock_audit.append({"phase":phase,"side":side,"joints":[list(p)for p in points],"expectedCrossSign":-1,"crossYZ":shin.y*meta.z-shin.z*meta.y,"interiorDegrees":180-shin.angle(meta)*180/math.pi,"metatarsalZ":meta.z})
            frames.append({"phase":phase,"torso":list(rig.pose.bones[prefix+"_torso"].head),"rearJoints":{side:[list(rig.pose.bones[prefix+"_rear_"+tag+"_"+side].head)for tag in ["upper","lower","ankle","paw"]]for side in ["l","r"]},"requestedTargets":{k:list(v)for k,v in requested_targets.items()},"paws":{end+"_"+side:list(rig.pose.bones[prefix+"_"+end+"_paw_"+side].head)for end in ["front","rear"]for side in ["l","r"]}})
        # Export deterministic linear keys rather than Bezier overshoot.
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:key.interpolation="LINEAR"
        if animal=="corgi":
            import runpy
            runpy.run_path(str(ROOT/"tools/blender/animal_quaternion.py"))["stabilize_action"](action,loop=clip!="death")
        report["clips"][clip]={"donor":None if clip=="death"else donor_key,"originalFrames":None if clip=="death"else source["sourceFrames"],"originalFps":None if clip=="death"else source["sourceFps"],"duration":duration,"frameRange":[1,count+1],"loop":clip!="death","horizontalRootDriftM":0,"maximumRequestedFootTargetErrorM":max_requested_error,"maximumReachClampM":max_clamp,"maximumFlightWorkspaceAdaptationM":max_flight_adaptation,"proximalEnvelope":{"frontMaxInwardDegreesFromBodyDown":50,"rearMaxInwardDegreesFromBodyDown":65,"outwardExtension":"unrestricted donor-oriented reach","minimumActualDown":min(v["actualDown"]for v in upper_audit)if upper_audit else None}}
        report["clips"][clip]["worstRequestedTarget"] = max(actual_targets,key=lambda v:v["error"])if actual_targets else None
        if clip in ["walk","run"]:
            report["clips"][clip]["nominalStanceSpeedMps"]=(13.2 if animal=="black-cat"else 12)if clip=="run"else 2
            report["clips"][clip]["contacts"]={end+"_"+side:{"donorCenterPhase":curves[end,side]["contactCenter"],"sourceContactDuty":curves[end,side]["sourceContactDuty"],"targetContactDuty":(((.70 if end=="front"else .90)if animal=="black-cat"else(.30 if end=="front"else .34))if clip=="run"else(.65 if animal=="black-cat"else .22))/report["clips"][clip]["nominalStanceSpeedMps"]/duration}for end in ["front","rear"]for side in ["l","r"]}
        (OUT/(animal+"-"+clip+"-poses.json")).write_text(json.dumps(frames))
        if hock_audit:
            assert all(v["crossYZ"]<-.000001 and v["metatarsalZ"]<0 and 44.9<v["interiorDegrees"]<165.1 for v in hock_audit),"Rear hock branch regression"
            report["clips"][clip]["hockBranchAudit"]={"crossSign":"negative as target rest and donor","minimumInteriorDegrees":min(v["interiorDegrees"]for v in hock_audit),"maximumInteriorDegrees":max(v["interiorDegrees"]for v in hock_audit),"maximumMetatarsalZ":max(v["metatarsalZ"]for v in hock_audit)}
        if clip!="death":
            report["clips"][clip]["maximumPawLoopSeamM"]=max((Vector(frames[0]["paws"][k])-Vector(frames[-1]["paws"][k])).length for k in frames[0]["paws"])
    rig["sagaburst_animation_baked"]=True
    (OUT/(animal+"-bake-report.json")).write_text(json.dumps(report,indent=2))
    select_action(rig,bpy.data.actions[animal+"__run"]);update(1)
    for o in bpy.data.objects:
        belongs=o==rig or o.parent==rig
        o.hide_set(not belongs)
        if belongs and o.type=="MESH"and any(o.name.endswith("lod"+str(i))for i in [1,2]):o.hide_set(True)
    rig.hide_set(True)
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type=="VIEW_3D":
                space=area.spaces.active;space.shading.type="MATERIAL";space.shading.show_xray=False;space.overlay.show_overlays=False;space.region_3d.view_perspective="ORTHO";space.region_3d.view_distance=5.8;space.region_3d.view_location=Vector((0,0,1.1));space.region_3d.view_rotation=Quaternion((0,0,1),math.pi/2)@Quaternion((1,0,0),math.pi/2)
    print(json.dumps(report))

def audit_soles(animal,clip="run"):
    spec=SPECIES[animal];prefix=spec["prefix"];rig=bpy.data.objects[spec["rig"]]
    mesh=next(o for o in rig.children if o.type=="MESH"and o.name.endswith("body_lod0"))
    baseline=next(a for a in bpy.data.actions if a.name.startswith("baseline_"+animal+"__")and a.name.endswith("idle"))
    select_action(rig,baseline);update(float(baseline.frame_range[0]))
    evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());clusters={};reference={}
    for end in ["front","rear"]:
        for side in ["l","r"]:
            key=end+"_"+side;group=mesh.vertex_groups[prefix+"_"+end+"_paw_"+side].index
            candidates=[v.index for v in mesh.data.vertices if any(g.group==group and g.weight>.35 for g in v.groups)]
            assert candidates,"No weighted sole vertices for "+key
            points={i:evaluated.matrix_world@evaluated.data.vertices[i].co for i in candidates}
            minimum=min(v.z for v in points.values());clusters[key]=[i for i,v in points.items()if v.z<minimum+.025]
            reference[key]={"minimumZ":minimum,"vertices":len(clusters[key]),"centroid":list(sum((points[i]for i in clusters[key]),Vector())/len(clusters[key]))}
    action=bpy.data.actions[animal+"__"+clip];select_action(rig,action)
    start,end=action.frame_range;poses=[];seconds=SPECIES[animal]["duration"][clip]
    for i in range(int(end-start)+1):
        update(start+i);evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());feet={}
        for key,indices in clusters.items():
            points=[evaluated.matrix_world@evaluated.data.vertices[j].co for j in indices]
            feet[key]={"minimumZ":min(v.z for v in points),"maximumZ":max(v.z for v in points),"centroid":list(sum(points,Vector())/len(points))}
        poses.append({"phase":i/(end-start),"seconds":i/(end-start)*seconds,"soles":feet})
    result={"animal":animal,"clip":clip,"reference":reference,"poses":poses}
    (OUT/(animal+"-"+clip+"-soles.json")).write_text(json.dumps(result))
    print(json.dumps({"animal":animal,"clip":clip,"reference":reference,"minimumZ":min(p["soles"][k]["minimumZ"]for p in poses for k in clusters)}))

def diagnose_proximal(animal):
    rig=bpy.data.objects[SPECIES[animal]["rig"]];prefix=SPECIES[animal]["prefix"]
    mesh=next(o for o in rig.children if o.type=="MESH"and o.name.endswith("body_lod0"));records=[]
    names=[prefix+"_"+end+"_"+tag+"_"+side for end in ["front","rear"]for tag in ["upper","lower","paw"]for side in ["l","r"]]
    groups={n:mesh.vertex_groups[n].index for n in names}
    for action_name in ["baseline_"+animal+"__idle","baseline_"+animal+"__canter",animal+"__run"]:
        action=bpy.data.actions[action_name];select_action(rig,action);start,end=action.frame_range
        for phase in [0,.25,.5,.75]:
            update(start+(end-start)*phase);evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());stats={}
            for name in names:
                indices=[v.index for v in mesh.data.vertices if any(g.group==groups[name]and g.weight>.5 for g in v.groups)]
                points=[evaluated.matrix_world@evaluated.data.vertices[i].co for i in indices]
                if points:
                    zs=sorted(p.z for p in points)
                    stats[name]={"vertexCount":len(points),"minZ":zs[0],"q10Z":zs[len(zs)//10],"medianZ":zs[len(zs)//2],"maxZ":zs[-1],"centroid":list(sum(points,Vector())/len(points))}
            records.append({"action":action_name,"phase":phase,"joints":{name:{"head":list(rig.pose.bones[name].head),"tail":list(rig.pose.bones[name].tail),"rotation":list(rig.pose.bones[name].rotation_quaternion)}for name in names},"weightedVertices":stats})
    (OUT/(animal+"-proximal-diagnostic.json")).write_text(json.dumps(records,indent=2))
    print(json.dumps({"diagnostic":str(OUT/(animal+"-proximal-diagnostic.json")),"poses":len(records)}))

def preview(animal,clip="run",phase=0.0,view="side"):
    rig=bpy.data.objects[SPECIES[animal]["rig"]]
    action=bpy.data.actions[animal+"__"+clip];select_action(rig,action)
    start,end=action.frame_range;update(start+(end-start)*phase)
    floor=bpy.data.objects.get("qa_neutral_ground")
    if not floor:
        bpy.ops.mesh.primitive_plane_add(size=20,location=(0,0,-.005));floor=bpy.context.object;floor.name="qa_neutral_ground"
        material=bpy.data.materials.new("qa_ground_material");material.diffuse_color=(.18,.18,.18,1);material.use_nodes=True
        shader=next((n for n in material.node_tree.nodes if n.type=="BSDF_PRINCIPLED"),None)or material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        output=next((n for n in material.node_tree.nodes if n.type=="OUTPUT_MATERIAL"),None)or material.node_tree.nodes.new("ShaderNodeOutputMaterial")
        shader.inputs["Base Color"].default_value=(.18,.18,.18,1);shader.inputs["Roughness"].default_value=1
        material.node_tree.links.new(shader.outputs["BSDF"],output.inputs["Surface"])
        floor.data.materials.append(material)
    if not len(floor.data.materials):
        material=bpy.data.materials.get("qa_ground_material")or bpy.data.materials.new("qa_ground_material")
        material.use_nodes=True;shader=material.node_tree.nodes.new("ShaderNodeBsdfPrincipled");output=material.node_tree.nodes.new("ShaderNodeOutputMaterial")
        shader.inputs["Base Color"].default_value=(.24,.24,.24,1);material.node_tree.links.new(shader.outputs["BSDF"],output.inputs["Surface"]);floor.data.materials.append(material)
    for o in bpy.data.objects:
        visible=o==floor or o.parent==rig
        if visible and o.type=="MESH"and any(o.name.endswith("lod"+str(i))for i in [1,2]):visible=False
        o.hide_set(not visible);o.hide_render=not visible
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type=="VIEW_3D":
                space=area.spaces.active;space.shading.type="MATERIAL";space.shading.show_xray=False;space.overlay.show_overlays=False
                space.region_3d.view_perspective="ORTHO";space.region_3d.view_distance=5.8;space.region_3d.view_location=Vector((0,0,1.05))
                space.region_3d.view_rotation=(Quaternion((0,0,1),math.pi/2)@Quaternion((1,0,0),math.pi/2-.08))if view=="side"else Quaternion((1,0,0),math.pi/2-.08)
    print(json.dumps({"animal":animal,"clip":clip,"phase":phase,"frame":float(bpy.context.scene.frame_current_final),"view":view,"neutralGroundZ":-.005}))

def front_limb_overlay(phase=.94,view="side",paw_close=False):
    preview("black-cat","run",phase,view);rig=bpy.data.objects["black_cat_rig"]
    rig.hide_set(False);rig.show_in_front=True;rig.data.display_type="OCTAHEDRAL";rig.data.show_names=True
    for bone in rig.data.bones:bone.hide=not bone.name.startswith("cat_front_")
    points={side:{tag:list(rig.pose.bones["cat_front_"+tag+"_"+side].head)for tag in ["upper","lower","paw"]}for side in ["l","r"]}
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type=="VIEW_3D":
                space=area.spaces.active;space.overlay.show_overlays=True;space.overlay.show_floor=False;space.overlay.show_axis_x=False;space.overlay.show_axis_y=False;space.overlay.show_text=False;space.overlay.show_relationship_lines=False
                space.region_3d.view_distance=2.8 if paw_close else 3.8
                space.region_3d.view_location=Vector(points["l"]["paw"])if paw_close else Vector((0,-.95,1.0))
                if view=="threequarter":space.region_3d.view_rotation=Quaternion((0,0,1),math.pi/4)@Quaternion((1,0,0),math.pi/2-.15)
    print(json.dumps({"phase":phase,"view":view,"pawClose":paw_close,"frontHeads":points}))

def transparent_front(phase=.94,view="side"):
    preview("black-cat","run",phase,view);rig=bpy.data.objects["black_cat_rig"]
    for o in list(bpy.data.objects):
        if o.name.startswith("qa_front_diagnostic_"):bpy.data.objects.remove(o,do_unlink=True)
    points={side:[rig.pose.bones["cat_front_"+tag+"_"+side].head.copy()for tag in ["upper","lower","paw"]]for side in ["l","r"]}
    for side in ["l","r"]:
        for i,(a,b)in enumerate(zip(points[side],points[side][1:])):
            bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.012,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.name="qa_front_diagnostic_"+side+str(i)
            o.rotation_mode="QUATERNION";o.rotation_quaternion=(b-a).to_track_quat("Z","Y");o.show_in_front=True;o.color=(1,.35,0,1)if i==0 else(0,.7,1,1)
        for i,point in enumerate(points[side]):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.028,location=point);o=bpy.context.object;o.name="qa_front_diagnostic_joint_"+side+str(i);o.color=[(1,.7,0,1),(0,.6,1,1),(1,0,.8,1)][i]
    for o in rig.children:o.color=(.55,.55,.55,1)
    bpy.ops.object.select_all(action="DESELECT");rig.hide_set(True)
    for w in bpy.context.window_manager.windows:
        for area in w.screen.areas:
            if area.type=="VIEW_3D":
                space=area.spaces.active;space.shading.type="SOLID";space.shading.color_type="OBJECT";space.shading.show_xray=True;space.shading.xray_alpha=.35;space.overlay.show_overlays=False;space.region_3d.view_distance=3.8;space.region_3d.view_location=Vector((0,-.95,1.0))
    print(json.dumps({"phase":phase,"view":view,"legend":{"orange":"shoulder to elbow","cyan":"elbow to paw","magenta":"paw pivot"},"frontHeads":{side:[list(p)for p in v]for side,v in points.items()}}))

def export_baked(animal):
    rig=bpy.data.objects[SPECIES[animal]["rig"]]
    for action in bpy.data.actions:action.use_fake_user=True
    select_action(rig,None)
    for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
    clips=["idle","walk","run","death"]+(["jump","land","hit"]if animal=="corgi"else[])
    for clip in clips:
        action=bpy.data.actions[animal+"__"+clip];track=rig.animation_data.nla_tracks.new();track.name=clip
        strip=track.strips.new(clip,1,action);strip.extrapolation="NOTHING";strip.blend_type="REPLACE"
        if len(action.slots):strip.action_slot=action.slots[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in [rig]+list(rig.children):o.hide_set(False);o.hide_render=False;o.select_set(True)
    bpy.context.view_layer.objects.active=rig
    for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
    update(0)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(animal+"-baked.glb")),export_format="GLB",use_selection=True,export_animations=True,export_animation_mode="NLA_TRACKS",export_force_sampling=True,export_frame_step=1,export_anim_slide_to_zero=True,export_optimize_animation_size=False,export_def_bones=False,export_armature_object_remove=False,export_leaf_bone=False)
    select_action(rig,bpy.data.actions[animal+"__run"]);update(1)
    print(json.dumps({"exported":str(OUT/(animal+"-baked.glb")),"clips":clips,"targetRig":rig.name,"background":bpy.app.background}))

def run(stage,animal=None):
    OUT.mkdir(parents=True,exist_ok=True)
    if stage=="import":import_donors()
    elif stage=="prepare":prepare_targets()
    elif stage=="sample":print(json.dumps([sample_donor(k)for k in DONORS]))
    elif stage=="bake":bake(animal)
    elif stage=="export":export_baked(animal)
    else:raise ValueError(stage)
