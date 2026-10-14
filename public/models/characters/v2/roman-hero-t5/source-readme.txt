面具羅馬：手裙權重修復版，與札甲戰士相同11動作清單

開啟 Masked_Roman_Selected_11Clips.glb 即可，模型／貼圖／66骨／11動作完整內嵌。
本檔延續已修好的原Meshy面具Roman，不是普通Roman步兵，也不是先前的31骨canonical候選。

正式11段（秒）
idle 2.70
walk 0.80
run 0.60
swordSlash 0.48
bowLoad 0.8333333
bowHold 1.3333333
bowRelease 0.22
pilumThrow 1.50
axeMountedIdle 2.70
axeAttack1H 3.00：使用者選定Meshy C，01a12ab1-2d1c-7250-8766-6ddefaee9ffa
axeAttack2H 2.8333333：使用者選定Meshy Attack
没有Dead、A、B或舊自製斧動畫。舊Walking／Running／Run_03不再重複收入；之前的Roman_Meshy_Selected_5Clips.glb與原修復版保留為備份。

保留與重定向
- 10,317三角面、16,225匯出頂點、原66骨、skin、UV、材質及3張原貼圖逐byte保留，沒有重畫權重、減面、縮圖或換模型。
- 手裙交叉權重沿用既有修復；最大15 influences仍保留，目標runtime須完整支援4組JOINTS_n／WEIGHTS_n，不能只讀前四個。
- C／Attack的全部key時間、數值、插值與root軌跡保持原樣。
- Core9由授權專案donor依22個人體關節映射到原Meshy骨架，使用各自rest骨軸與原人物骨長；T-pose→A-pose另做肢軸校正，足趾保留鞋底rest差異，不是不同rig直接硬塞tracks。
- Core骨盆平面固定；本次9段donor沒有骨盆位移軌，垂直也維持原rest高度。比例計算依實際人體網格離地高度，不取骨架顯示用shape。原高約1.70m與ground約0不變。
- Core保原時長；在來源關鍵點與密集時間點求值，再以150Hz輸出；source旋轉以SLERP評估，四元數符號連續化，避免長弧翻轉。每次求值清空來源未key骨，防部分動畫繼承其他姿勢。
- Core全部66骨皆有明確TRS tracks，包含40個手指骨的rest姿勢。來源core無手指動畫，因此沒有虛構握柄／扣弦；切換不依赖上一段手指殘值。

檢查與限制
見audit/Audit.json與預覽。結構、原始資料保留、骨長、手裙交叉污染與時長檢查通過。
150Hz輸出不能保留所有非整幀轉折點：獨立來源方向檢查，swordSlash最高約0.1231度；bowRelease最高約1.8778度（足趾約1.7584度），超過audit自訂0.1度嚴格門檻，保留為重採樣warning，不稱每個時刻完全等同來源。已輸出整幀的誤差≤0.000161度。
原速影片包含walk/run各3循環、C單手與Attack雙手正側面。
Core手指保持rest，C／Attack保原有手指動作；真武器握柄、双手同柄、弦貼指與盾牌attachment尚未final。
Attack先前代理握柄檢查左手誤差約4.5cm RMS、最大13.6cm，本次沒有為消除此誤差改原始動作。
未做正式遊戲runtime、碰撞、腳底IK、騎乘鞍座與所有連續幀蒙皮品質驗收；axeMountedIdle保留來源上身idle，來源未key的下肢使用rest，因此預覽是站姿；實際騎乘坐姿需runtime FK另行驅動，不代表已完成騎姿。
「與札甲戰士相同」指正式動作名稱與來源組合一致，不表示兩個不同骨架／體型可逐骨互換tracks。
沒有更動札甲戰士、普通步兵、repo或建立PR。

來源與使用條款
人物／貼圖及兩斧：使用者Meshy biped素材；權利依其帳戶方案、Meshy服務條款與輸入素材權利，不宣稱CC0。
Core9：使用者SagaBurst commit bf2b3d3f788101ffa418bafea0a7e4b6c06d25c5，roman/lod1.glb，SHA256 4d52984c6d67137b7de636138cfed77023b0b43242188c2b3bceaf050353ce52。
Locomotion／bow等：Kevin Iglesias，Unity Asset Store EULA；swordSlash／pilumThrow：Quaternius，CC0；axeMountedIdle沿專案Viking carry對應來源條款。
未附donor人物網格／貼圖或獨立原始animation bank。此為使用者合法專案內重用，不宣稱整包可公開拆售或任意再散布。

有限視覺檢查補充
只檢視代表姿勢與預覽接觸表，未完成逐幀原速或目標引擎驗收。所檢視姿勢未見明顯肩袖爆裂或手裙牽連；抬臂弓姿上背有折面／陰影，局部變形與光照品質仍需確認。武器接觸、碰撞、地面接觸與動畫混合尚未驗收。
