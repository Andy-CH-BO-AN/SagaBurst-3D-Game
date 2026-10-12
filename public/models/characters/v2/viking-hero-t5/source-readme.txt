札甲戰士 Steppe：C 單手斧／Attack 雙手斧，11 動作候選版

開啟本次單包
解壓最外層 ZIP 後，匯入 Steppe/Steppe_Selected_11Clips_Candidate.glb。
模型、骨架、十一段動作及三張完整貼圖均已內嵌，不需要舊 A／B 分包或外部 PNG。

本次新增
axeAttack1H：使用者選定 Meshy C（01a12ab1-2d1c-7250-8766-6ddefaee9ffa），3秒。
axeAttack2H：使用者選定 Meshy Attack，2.833333秒。
不是自製斧動作；沒有加入 A／B／Dead。
保留既有 idle、walk、run、swordSlash、bowLoad、bowHold、bowRelease、pilumThrow、axeMountedIdle，共11段。

重定向方式
Meshy 66骨的22個主要人體關節，依來源／目標 rest-frame 骨軸映射到Steppe自己的22主骨，依目標骨長重建階層關節位置，不是只改骨名或直接貼 local rotation。
按照原Steppe inplace約定，骨盆平面位移固定在 fitted rest，保留依身高比例換算的上下重心；來源動作時長不變、以30Hz烘焙；四元數逐骨做符號連續化，避免等價旋轉的正負號跳變造成插值翻轉。
保留既有37骨、5個裙甲helper及skin；新兩段皆烘焙前後裙／中央前垂片控制。未改幾何、綁骨比例、材質或貼圖。

限制
Steppe是整手由hand骨帶動，沒有獨立指骨，來源手指閉合無法轉移；手掌輪廓仍開放。
不同肩寬／臂長會改變兩手間距；未做双手握同柄鎖定、真武器attachment或碰撞解算，影片不含真武器。
這是離線動畫資產候選，可供檢視播放，不宣稱遊戲runtime、手柄接觸與所有連續幀穿插均已驗收。
原9段的建模、蒙皮、坐姿、授權與使用限制見 README_Core9_來源與限制.txt。該歷史說明的「斧尚未加入」已由本次選定兩段更新，其餘來源與限制繼續適用。

來源
新增兩段出自使用者提供的Meshy Roman biped包，適用Meshy帳戶／服務／输入素材權利，不宣稱CC0。
原9段仍有專案內既有Kevin Iglesias Asset Store EULA與Quaternius CC0等混合來源；沒有附獨立原始animation bank、donor人物網格或貼圖。
沒有修改repository或建立PR；一般Roman／Viking尚未處理。
