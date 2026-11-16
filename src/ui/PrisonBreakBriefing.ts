/** Shared by the saved battle result and captured-save recovery screens. */
export const PRISON_CAPTURE_TITLE = '戰役敗北・你被俘虜了'
export const PRISON_CAPTURE_DESCRIPTION = '你和友軍被敵軍俘虜，武器已被沒收。'
export const prisonCaptureObjective = (guardCount: number): string =>
  `擊倒 ${guardCount} 名看守就能打開鐵門。你或任一名存活隊友穿過出口，全隊就算逃脫成功。`
export const PRISON_CAPTURE_ACTION = '開始越獄'
