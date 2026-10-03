"""Adapt evaluated donor contact windows to a target stride and ground speed.

The body keeps the donor cycle. Each foot preserves its source support order,
while its support window is shortened to stride / speed and the original
swing samples are reparameterized into the remaining cycle.
"""
import math


def contact_window(points):
    points=points[:-1]
    n=len(points);zmin=min(p[1]for p in points);height=max(p[1]for p in points)-zmin
    flags=[points[i][1]<zmin+height*.32 and points[(i+1)%n][0]>points[(i-1)%n][0] for i in range(n)]
    runs=[]
    for i in range(n):
        if flags[i]and not flags[(i-1)%n]:
            count=0
            while count<n and flags[(i+count)%n]:count+=1
            runs.append((count,i))
    if runs:
        count,start=max(runs);duty=min(.65,max(.06,(count+1)/n));center=(start+(count-1)/2)/n%1
    else:
        center=min(range(n),key=lambda i:points[i][1])/n;duty=.25
    return center,duty


def phase_map(phase,center,source_duty,target_duty):
    u=(phase-center+target_duty/2)%1
    start=center-source_duty/2
    if u<=target_duty:
        source_phase=(start+u/target_duty*source_duty)%1
        return source_phase,True,u/target_duty
    swing=(u-target_duty)/(1-target_duty)
    source_phase=(start+source_duty+swing*(1-source_duty))%1
    return source_phase,False,swing


def foot_trajectory(phase,curve,stride,speed,seconds,sample,clamp_swing=True):
    duty=stride/(speed*seconds)
    assert 0<duty<.85,"Target stance must leave time for donor swing"
    source_phase,contact,u=phase_map(phase,curve["contactCenter"],curve["sourceContactDuty"],duty)
    value=sample(source_phase)
    if contact:
        return -stride/2+stride*u,0.0,source_phase,True,duty
    # Original donor fore/aft swing, with continuous endpoint corrections.
    a=sample((curve["contactCenter"]+curve["sourceContactDuty"]/2)%1)
    b=sample((curve["contactCenter"]-curve["sourceContactDuty"]/2)%1)
    span=max(curve["yMax"]-curve["yMin"],1e-8)
    y=(value.y-curve["center"])/span*stride
    y+=(1-u)*(stride/2-(a.y-curve["center"])/span*stride)+u*(-stride/2-(b.y-curve["center"])/span*stride)
    # A fast, bounded toe-off makes non-contact phases leave the ground; its
    # envelope closes at landing, while retaining the sampled donor lift shape.
    lift=max(0,min(1,(value.z-curve["zMin"])/max(curve["zMax"]-curve["zMin"],1e-8)))
    envelope=max(0,math.sin(math.pi*u))**.4
    lift=envelope*(.35+.65*lift)
    return (max(-stride*.5,min(stride*.5,y)) if clamp_swing else y),lift,source_phase,False,duty
