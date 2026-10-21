普通 Viking Infantry LOD0：11動畫、局部修皮與修正斧頭握法
GripAndWeaponAdjusted DERIVED，2026-10-11修訂

先用主入口
Viking_Infantry_LOD0_GripAndWeaponAdjusted_DERIVED_11Clips.glb：乾淨角色與完整11動畫，不含Mock。
Viking_11Clips_Mock_GripAndWeaponAdjusted_DERIVED.glb：相同角色動畫，附Mock劍、單／雙手斧、弓、標槍、盾。
Viking_11Clips_Mock_GripAndWeaponAdjusted_DERIVED_OriginalSpeed.mp4：正側雙視角，1280×768、30fps、510幀、17秒，原速。
Viking_11Clips_Mock_GripAndWeaponAdjusted_DERIVED_Overview.jpg：11招式總覽。
Viking_2H_GripAndWeaponAdjusted_DERIVED_OriginalSpeed.mp4：最新雙手斧正側原速短片，85幀、2.833333秒。
audit/：精簡最終稽核、socket、來源與數值連續性報告。
reproduction/：成功的bake／render／compose腳本及凍結數值輸入，可從本包兩個GLB已保留的binary前綴恢復原始bake輸入，無須再打包重複source GLB或blend。詳見其README。
本版為精簡主交付，只放最新五個資產、必要可重現腳本、README與manifest。歷史GLB、舊完整包、blend、render、checkpoint、詳細研究另存本地HistoricalArchive及既有Library舊版本，不混入主ZIP。

這次真正修正了甚麼
原2H斧頭放在左副手一側：右手靠柄尾、左手靠斧頭，高舉时斧頭反而垂在手下。問題是頭尾／握序，不是單純刃面roll180度。現固定socket的local +Z指向斧頭，右手近頭、左手在負Z的柄尾側滑握。
保留重斧頭原外形與厚度。木柄從−0.30至+0.75m，總長1.05m；鋼頭沿Z為+0.47至+0.79m；副握參考色帶在−0.28至−0.08m。
先固定端翻／傾軸校準socket，另把必要右腕與左手修正烘焙進axeAttack2H。武器相對Hand.R始終是同一固定矩陣，没有逐幀獨立移武器追手。
只有UpperArm.L、Forearm.L、Hand.L、Hand.R四條旋轉軌跡改動，18個其他骨的矩陣保持相同。骨長、22骨階層與bind、人物geometry／skin／UV／materials／textures均保留。前10動畫完整records保持修皮基底原樣；axeAttack2H仍2.833333秒，没有變速或改腿／軀幹。
右腕主砍最大修正10.18°；回收追加外帶後，相對來源全段最大30.88°。左上臂／前臂／手最大局部角差25.10°／25.49°／29.50°。左腕位置最大改動約17.84cm。這是明示衍生動作，不能稱與原動作完全相同。
最後避身修正只在回收段：求解時相對前一候選，1.7秒以前逐float保留，0.9–1.2秒有效快砍未改。最終出檔另將4條衍生rotation做unit normalization，僅移除約1e−5長度誤差，新4軌最大norm殘差3.72e−8，全11段最大1.39e−7；旋轉方向在float32數值精度內等價，詳見normalization前後稽核，不將這一步誤稱raw bytes完全相同。原源動作與前一版本保留於歷史存檔；本包也可按reproduction步驟恢復精確bake輸入。

握柄、刃向、地面與穿身檢查
150Hz烘焙時，實際蒙皮左掌區centroid到握點誤差最高約0.002mm。新GLB重新匯入300Hz、851個含端點樣本：左掌到握點最高3.124mm，離柄軸1.705mm；右掌區centroid到固定socket最高4.640mm。clean與Mock的22骨姿態一致。
這些是實際蒙皮掌區中心的量測，不是只測bone marker。模型沒有指骨，開掌造型保留；掌心貼柄不代表手指閉合或已完成手部接觸造型。
滑握目標限速0.8m/s；300Hz插值後實際瞬時軸向速率可達約1.586m/s，不能宣稱連續時間也嚴格限速0.8。
高能砍擊時銀色切刃方向與非軸向刃口速度的cos最低約+0.642，攻擊區間速度加權約+0.729；回收/準備不是同一刃向判定窗口。
整支Mock斧所有頂點最低Y（Blender Z）為−0.9376815m，預覽地面−0.96m，餘量22.32mm；相對角色rest腳底平面−0.95138985m，餘量13.71mm。
獨立fresh Blender 300Hz全段weapon表面edge→body三角BVH檢查：非握區交點0，包含鋼頭、銀刃和木柄；此前尾柄穿袖口／腹前衣甲的427項警訊在本版清除。2.013、2.333、2.45秒近景確認原穿入處已退出。
此檢查將距任一實際掌心9cm內或平均hand權重>0.25的body faces標作近握區。6497項近握區事件全是木柄碰平均Hand權重>0.25的手部三角形，沒有僅靠9cm距離豁免的事件；仍不能把這些接觸自動當正確解剖握持。這是有限取樣的表面線段篩查，並非連續時間掃掠、完整體積碰撞或遊戲runtime認證。

原速連續性與局部skin限制
Forearm.L在1.01333→1.01667秒的最大300Hz步幅9.2186°，前後為9.116／9.116／9.219／9.219／7.203°，位於原快速砍擊而非收招孤立翻轉；原同段3.870°，此衍生局部加快約2.38倍。四元數相鄰符號連續。1.25秒後Forearm.L最大步幅2.022°；RightHand最大1.440°，没有新增收招180度反號。
修皮基底保留8967頂點、10290三角；2349個局部衣袖／腋下／毛領頂點改權重，6618個頂點JOINTS／WEIGHTS原bytes不變。沒有剪面、切拓撲、加內襯或全身auto-bind；LOD1／LOD2未動。
已知triangle1052的7.882cm邊：bowHold 0.667秒由42.398cm降至9.545cm；單手斧C 1秒由55.974cm降至11.805cm。原大型肩袖拉片明顯改善，但C 1.6秒右背鏈甲仍有16.295→35.414cm的長邊伸展；不是無瑕疵衣物模擬。
本新2H相對b929基底的150Hz獨立skin檢查：新增最大邊長19.64mm，在2.293秒右腕edge5618–5635，由57.01至76.65mm；有154個sample×triangle新壓縮事件，27個unique triangles，去重rest面積占全網格0.271%。局部袖根、腕部折皺／壓縮仍在；極端近景未見新增大片拉片、斷腕或整片軀幹拖動。
人物腳底沒做IK。rest參考平面−0.95138985m；C最深約−0.988341m，比rest低3.70cm；2H 150Hz最低−0.986488m，比rest低3.51cm。這些與原動作相同。上述斧頭清地通過不能解讀成全角色足底零穿地。
原bowRelease來源重採樣曾有約6.06°warning，本次没有重選／重採樣該招。axeMountedIdle保留站姿下肢，尚無馬／馬鞍配合。尚未驗收遊戲runtime、全部動畫blend、連續碰撞或完整自穿插。

11段與來源
idle2.7、walk0.8、run0.6、swordSlash0.48、bowLoad0.833333、bowHold1.333333、bowRelease0.22、pilumThrow1.5、axeMountedIdle2.7、axeAttack1H3.0、axeAttack2H2.833333秒。C是axeAttack1H；Attack是axeAttack2H。沒有A／B／death。
角色是普通Viking步兵，沒有替換英雄。來源Viking_Infantry_LOD0_Rigged.glb；原metadata記錄andypig9於2026-10-10用Meshy6 Lite生成，CC BY4.0依使用者提供的Meshy UI記錄。既有rig、局部修皮、重定向與本衍生動作都是修改。
core9原manifest：idle／walk／run／bowLoad／Hold／Release來自Kevin Iglesias，適用Unity Asset Store EULA；swordSlash／pilumThrow來自Quaternius UAL2，CC0 1.0；axeMountedIdle為專案Viking authored idle。C／Attack為使用者提供的Meshy動作，依其帳戶／服務及輸入素材權利。整包不是統一CC0或CC BY，發佈使用須保留各來源權利。
Mock武器是本次程序建立的測試幾何，沒有外購武器素材。弓弦、箭和投槍離手仍是程序示意：放箭0.060秒、回弦0.050秒、箭8m/s；投槍0.633333秒離手、初速5m/s與9.81m/s²重力。不是來源原有gameplay事件或runtime實作。
源selected11 SHA256：de419f52059da83e40d48da9fcbf10efab894c6576d56bdf1498ca552d78e675。
局部修皮原動作基底b929 SHA256：b9298bf80296a1969e2b33b29cf6a579aa341c0e0cf734ce7238fd9c7d6dcc0c。

完整SHA256.json／SHA256SUMS.txt涵蓋本包全部內容（不自我雜湊）。audit中的絕對來源路徑是建置紀錄；完整診斷在歷史存檔，本包腳本請用相對路徑執行。未改repository、未部署、未購買素材、未覆寫來源檔。
