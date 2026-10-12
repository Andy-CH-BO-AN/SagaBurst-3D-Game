歷史背景：本次已加入選定 Meshy C／Attack 兩段斧攻擊；下文關於未加入斧攻擊的舊狀態，不適用本次 11 動作版。

Steppe Iron Guard 10K：自製骨架／9段基本動作 v1

本包狀態
離線資產候選版。原無骨架的Steppe模型已建立project-humanoid基礎骨、裙甲輔助骨與skin，可在Blender/glTF檢視器直接播放9段動作；沒有修改SagaBurst repo、做runtime整合或建立PR。
兩個舊斧攻擊未收入本包；原創單／雙手斧動作另行驗收後再套用，不把舊動作當成新成果。

本次單包開啟方式
請依本資料夾 README_繁中.txt 開啟完整 11 動作 GLB；下列內容是原 9 動作版本的來源與驗證記錄。歷史提到的壓力測試圖片、重建程式及獨立走跑短片沒有另外收入本次單包。

模型／骨架
- 10,389三角形、15,491頂點；未減面、增面、切裙或重造人物。
- 來源只平移(Blender座標0,+0.08,+0.949041)至地面／骨盆投影，沒有非均勻縮放。含盔飾身高約1.894516m，保留來源比例，需要独立asset descriptor。
- glTF米制、+Y up、+Z forward、scale 1。
- 37 joints：22個基礎與額外上胸／鎖骨、9 sockets、5裙甲helper、1劍鞘骨。
- 每頂點匯出上限4 influences；本版實際最多3，全部正規化。
- 左右手目前各由hand骨帶動；沒有新增獨立指骨，近景握柄／扣弦的手指閉合未完成。

綁定方式及修正
- 先檢查UV接縫焊接後連通與水平截面，确认裙下有完整雙褲腿。
- 以確切手臂／前垂片／劍鞘連通種子，加上衣殼與褲面內外射線及人工視覺檢查分區，再按解剖關節區間做平滑權重。
- 中央胸甲剛性；肩腋接縫過渡。不是全身單純最近骨距離權重。
- 前左右、後左右、中央前垂片各有skirt helper；劍鞘綁獨立rigid骨，腰包／腰帶隨骨盆。
- 修正劍鞘中段漏分區的4個焊接点／13個來源頂點，避免鞘被裙骨折彎。
- 手臂採raw z<0.30之確切連通片，避免抬臂時誤拉腰飾。
- 原右褲腿与裙下擺在raw約(-0.235,-0.150,-0.478)有局部幾何接觸連接；本次不盲目切開，以免露洞。代表走跑／坐姿未見大幅拉絲，但極限動作與真實坐騎仍要驗證此區。

9段動作與秒數
idle 2.70
walk 0.80
run 0.60
swordSlash 0.48
bowLoad 0.8333333
bowHold 1.3333333
bowRelease 0.22
pilumThrow 1.50
axeMountedIdle 2.70（持斧騎乘待機來源，不是新斧攻擊）
依本模型解剖位置／骨軸重定向，保留自己四肢長度；腳／趾有鞋底rest correction。骨盆水平位置固定，保留垂直起伏。clip時長與授權donor一致，末幀不截短。

裙甲控制
本次9個clip已烘焙skirt helper，單獨播放不需要cloth模擬。
但遊戲後續FK坐姿、巨鷹站姿或新動畫，必須同步驅動helper，不能只動大腿骨。
animate_steppe.py包含控制規則：移除骨盆全身旋轉後，取左右大腿rest→pose swing；前裙跟隨90%、後裙70%；中央前垂片依兩腿最大向前屈曲抬起90%。這是可編輯的簡化控制，並非布料物理或碰撞解算。

已驗證
- 最終9clip GLB重新匯入後，idle/走/跑/劍/弓三段/標槍共73個代表幀。
- 正、側面坐姿／巨鷹站姿／抬臂共6張壓力測試。Steppe_Stress_Checks.jpg有全圖。
- Steppe_Walk_Run_RealSpeed.mp4為原clip速度，走0.8s與跑0.6s各3循環，共4.2s。
- 獨立結構audit：3,359時刻、124,283 skin matrices均有限；精確左796／右791手臂頂點僅同側arm/hand；裙片沒有手臂權重；已確認120個鞘頂點皆scabbard=1。
- 三角角點／UV保留；法線最大方向差0.03333°，bind rest頂點最大誤差約2.75e-6m。

未完成／限制
- 無正式武器、盾、弓弦、馬、巨鷹或鞍座的握點／碰撞驗收。
- 坐姿會把長前裙抬起，後裙仍是大片壓縮；真實鞍座／背部穿插須在遊戲確認。上臂極限抬舉仍受來源寬袖結構限制，不宣稱cloth特寫品質。
- 未做手指閉合、雙手握同柄、弦貼指；新原創斧不在本包。
- 未新增雙手槍clip；左盾單手槍是待runtime的FK流程。pilumThrow僅為投擲標槍。
- 無LOD，未校準一般Roman/Viking的固定尺寸，未做遊戲事件／武器attachment／LOD同步整合。
- audit是結構與取樣檢查，不是runtime或所有連續時間的碰撞認證。

來源與條款
模型／貼圖：使用者提供 Meshy_AI_Steppe_Iron_Guard_10K_1011092445_texture.glb，原始檔保留。
Meshy輸出權利依帳戶方案、服務條款及原始輸入權利，不宣稱CC0。
動畫／rig donor：使用者SagaBurst專案commit bf2b3d3f788101ffa418bafea0a7e4b6c06d25c5，roman/lod1.glb，SHA256 4d52984c6d67137b7de636138cfed77023b0b43242188c2b3bceaf050353ce52。
Locomotion／bow：Kevin Iglesias，Unity Asset Store EULA；swordSlash／pilumThrow：Quaternius，CC0 1.0。axeMountedIdle源自專案Viking carry，沿用專案對應來源條款。
Donor追溯模型：Andy Woodhead，Roman Soldier - T pose - free download，CC-BY-4.0；https://sketchfab.com/3d-models/roman-soldier-t-pose-free-download-61cd5cae148042c38048bff2bd206af3 。本成品未使用其人物網格或貼圖。
這是使用者现有專案內重用，非全CC0資產或可任意公開拆售之animation bank。未附原donor GLB/FBX/archive。
