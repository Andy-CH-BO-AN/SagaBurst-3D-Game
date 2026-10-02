import { CAREER_RANKS, CAREER_RANK_THRESHOLDS, enlistmentMerit, type CareerProfile, type CareerRank } from './CareerProfile'
import type { CharacterFaction } from '../world/CharacterVisuals'

export type DialogueRole = 'merchant' | 'ranger' | 'cat' | 'captain' | 'deployment' | 'civilian'
type Ranked = Record<CareerRank, string>
const ranked = (...lines: [string, string, string, string, string]): Ranked => Object.fromEntries(CAREER_RANKS.map((rank, i) => [rank, lines[i]])) as Ranked
interface Speaker {
  firstMeet: string
  greetingByRank: Ranked
  interactionOpen: string
  tierLocked: string
  insufficientMerit: string
  alreadyOwned: string
}
interface TownDialogue {
  speakers: Record<DialogueRole, Speaker>
  promotionLocked: Ranked
  promotionEligible: Ranked
  promotionSuccess: Ranked
  missionByRank: Ranked
  soldierFirstOutpost: string
  horsePurchaseSuccess: { cat: string; ranger: string }
  ambient: string[]
}
const speaker = (firstMeet: string, greetingByRank: Ranked, interactionOpen = '', tierLocked = '', insufficientMerit = '', alreadyOwned = ''): Speaker => ({ firstMeet, greetingByRank, interactionOpen, tierLocked, insufficientMerit, alreadyOwned })

/** Peaceful dialogue only. Future missions are discussed as duties, never offered as playable content. */
export const CAREER_TOWN_DIALOGUE: Record<CharacterFaction, TownDialogue> = {
  roman: {
    speakers: {
      merchant: speaker('新兵？看得出來。你握劍的手還太乾淨。\n軍團會給你能活命的東西。想拿更好的，先把軍階和軍功備齊。',
        ranked('新兵。先學會別把劍拿反。', '又回來了？看來你第一次沒死。', '我替你留了些好東西。', '隊長。今天需要什麼？', '指揮官。能給你的最好裝備都在這裡。'),
        '說吧。短劍、長槍、盾，還是遠程武器？\n先看價目。', '這不是給你現在這個軍階用的。\n先去找隊長。等你的軍階夠了，再回來。', '你有資格拿它，但你的軍功還不夠。\n資格和買得起，是兩回事。', '這件你已經買過了。\n你需要的是保養它，不是再買一件。'),
      ranger: speaker('牠才是老闆，我只是負責跟人說話。\n如果牠不喜歡你，我也幫不了你。',
        ranked('先騎普通馬吧。至少牠比較願意原諒新手。', '你看起來終於不像第一次碰馬了。', '現在可以開始挑點有個性的坐騎了。', '隊長。今天想換個更醒目的坐騎？', '如果連你都駕馭不了，那我也不知道該賣給誰了。'),
        '軍用戰馬買一次就夠，隨軍階提升，隊長可用 T4。黑貓與柯基先看價目。\n別問為什麼黑貓比馬貴。你自己看牠一眼就知道了。', '你現在還駕馭不了這種坐騎。\n先活久一點吧。', '資格有了，軍功還差一些。\n資格和付得起，是兩回事。', '那隻已經是你的了。\n別裝作第一次看到牠。'),
      cat: speaker('黑貓盯著你看了一會兒。\n牠似乎正在判斷你有沒有資格碰這裡的馬具。',
        ranked('黑貓瞥了你一眼。', '黑貓抖了抖耳朵。', '黑貓站起身，終於認真看了你一眼。', '黑貓站起身，終於認真看了你一眼。', '黑貓站起身，終於認真看了你一眼。'),
        '黑貓用尾巴拍了拍旁邊的價格牌。', '黑貓瞥了你一眼，很快又失去了興趣。', '黑貓看了一眼你的軍功牌，又把頭轉了回去。', '黑貓聞了聞你。\n牠似乎還記得你。'),
      captain: speaker('報上軍階。\n軍團只承認正式任命。你的名字和戰績，我會記錄。',
        ranked('還活著？很好。', '士兵。保持你的紀錄。', '老兵。我已經看過你的戰績。', '隊長。你現在該開始注意你身後的人。', '指揮官。\n我已經沒有更高的軍階可以授給你了。'), '任命依入伍以來的軍功紀錄核定。'),
      deployment: speaker('我是士官長，負責派發新兵任務、補給箭矢，也會帶你熟悉出戰流程。',
        ranked('新兵，先熟悉村莊。', '士兵，原本的新兵任務仍可接。', '老兵，低階任務依然開放。', '隊長，原本的任務仍在板上。', '指揮官，任務板仍向你開放。'), '選一項已解鎖的任務；守城時我也會親自出戰。'),
      civilian: speaker('', ranked('新來的？', '又要出城？', '聽說前線最近不太平。', '隊長。', '指揮官。')),
    },
    promotionLocked: ranked('還不夠。\n軍階不是獎品。回去立功。', '你的紀錄還不足以讓我推薦你。', '隊長不是一件更好的盔甲。\n你還沒準備好承擔別人的性命。', '你要的是整支軍隊的責任。\n達到規定軍功以後，再來申請。', '我已經沒有更高的軍階可以授給你了。'),
    promotionEligible: ranked('你的軍功已經達標。\n依軍團規定，你有資格晉升為 {nextRank}。接受任命嗎？', '你的紀錄已經足夠。\n你有資格接受 {nextRank} 任命。', '{required} 軍功。\n你已經不是靠運氣活到今天的人了。\n你有資格接受隊長任命。', '{required} 軍功。\n你的紀錄已經沒有問題。真正的指揮官，要等戰場來證明。', ''),
    promotionSuccess: ranked('', '從現在起，你不再是新兵。\n別讓這個軍階變成你墓碑上的裝飾。', 'Veteran。\n別人會開始看你怎麼活下來。', 'Captain。\n先學會把你的人帶回來，再想著當英雄。', 'Commander。\n記住這份任命的責任。'),
    missionByRank: ranked('查看已解鎖的新兵任務。', 'Outpost Duty 已開放；可接受前線防守任務。', '新兵任務仍可接受。', '隊長，新兵任務仍可接受。', '指揮官，已解鎖的任務仍可接受。'),
    soldierFirstOutpost: '前線 Outpost 缺人。\n你現在是正式士兵了，該開始了解站牆的職責。\n你仍只是其中一名士兵，到了那裡要聽隊長命令。\n向士官長接受 Outpost Duty，從 Outpost I 開始。',
    horsePurchaseSuccess: { cat: '黑貓把爪子從登記簿上移開了。', ranger: '已登記。這匹戰馬是你的了。' },
    ambient: ['兵營在那邊。', '今天的市集還算安靜。', '那些騎兵一大早就在吵。', '只要前哨站還在，我們就還有時間。'],
  },
  viking: {
    speakers: {
      merchant: speaker('別一直看我。我是羅馬人，沒錯。\n但他們喜歡我的劍，所以我還活著。',
        ranked('又一個新來的。\n至少先挑把不會害死自己的東西。', '喔，你還活著。\n那看來可以給你看點像樣的東西了。', '最近有人一直提到你的名字。\n希望不是因為你欠錢。', '隊長。今天想拿什麼去砍人？', '哈，我們的大人物來了。\n看吧。反正現在也沒人敢說你不夠格。'),
        '你有軍功，我有兵器。\n先看價目。別急。', '你拿得起，不代表他們准你拿。\n去找隊長。', '軍階夠了，袋子卻不夠重。', '你不是已經買過了？\n你需要的是磨刀，不是再買一把。'),
      ranger: speaker('別碰牠的尾巴。\n上一個這麼做的人，現在還在學怎麼走路。',
        ranked('先學會別從普通馬上摔下來。', '你總算有點像真的戰士了。', '現在可以挑點跑得快、脾氣也大的了。', '隊長。這次你應該不會被坐騎甩下來吧？', '你都當上 Commander 了。\n要是牠還是不肯載你，那就是牠的問題。'),
        '軍用戰馬買一次就夠。當上隊長，就能騎 T4。\n黑貓和柯基先看價目。想騎牠？那就不是普通馬的價錢了。', '等你真的夠資格，再回來談。\n牠不載菜兵。', '資格有了，但軍功還不夠。', '那隻已經認得你了。\n別再花一次軍功。'),
      cat: speaker('黑貓坐在雪地裡看著你。\n牠完全沒有要讓路的意思。',
        ranked('黑貓打了個哈欠。', '黑貓懶懶地瞥了你一眼。', '黑貓站了起來。\n這次牠似乎願意認真看你一眼。', '黑貓站了起來。\n這次牠似乎願意認真看你一眼。', '黑貓站了起來。\n這次牠似乎願意認真看你一眼。'),
        '黑貓用爪子踩住了馬店的價格牌。', '黑貓打了個哈欠。', '黑貓瞥了一眼你的軍功牌。\n牠看起來一點也不感興趣。', '黑貓聞了聞你。\n看來牠還記得你。'),
      captain: speaker('你是新來的？\n很好。那先別死。',
        ranked('還活著啊。', '現在至少能叫你戰士了。', '你的名字我已經聽過不少次。', '隊長。你的人最好也能活著回來。', '我們的大人物來了。\n還想我叫你什麼？國王嗎？'), '想升軍階？拿紀錄來。'),
      deployment: speaker('我是士官長。新兵任務、箭矢補給和出戰流程都來找我；守城時我也會上陣。',
        ranked('新來的，別迷路。', '戰士，原本的新兵任務還在。', '老兵，低階任務照樣能接。', '隊長，任務板還開著。', 'Commander，已解鎖的任務照樣能接。'), '挑一項任務，先把自己準備好。'),
      civilian: speaker('', ranked('新來的？別迷路。', '看來你第一次出去沒死。', '最近到處都有人談你的戰績。', '隊長。', 'Commander。')),
    },
    promotionLocked: ranked('不夠。\n你要的是軍階，不是一碗麥酒。', '你還沒打到讓人記得你。', '達標以前，別急著讓別人聽你的。', '想叫整支軍隊聽你的？\n先把規定的軍功放到我面前。', '你已經是 Commander 了。\n還想我叫你什麼？國王嗎？'),
    promotionEligible: ranked('你活得夠久，也打得夠狠。\n夠資格當真正的戰士了。', '你已經不需要別人教你怎麼殺人。\n夠資格當 Veteran 了。', '{required} 軍功。\n夠了。你有資格接下隊長的名號。', '{required}。哈。\n看來你有資格接下 Commander 了。', ''),
    promotionSuccess: ranked('', 'Soldier。\n現在別死得太難看。', 'Veteran。\n現在新人會看你怎麼打。', 'Captain。\n把他們帶回來。至少大部分。', 'Commander。\n現在別讓整支軍隊一起送死。'),
    missionByRank: ranked('看看已解鎖的新兵任務。', 'Outpost Duty 開了；前線缺個能站崗的人。', '老兵，新兵任務仍可接受。', '隊長，新兵任務仍可接受。', 'Commander，已解鎖的任務仍可接受。'),
    soldierFirstOutpost: '前哨站在缺人。恭喜。\n你現在夠格去最冷、最遠的地方站崗了。\n到了那裡別裝隊長。你只是其中一名士兵，聽命令辦事。\n找士官長接 Outpost Duty，先守住 Outpost I。',
    horsePurchaseSuccess: { cat: '黑貓把爪子從登記簿上移開了。', ranger: '記下了，牠是你的了。別摔得太難看。' },
    ambient: ['兵營在那邊。聽聲音就知道了。', '雪又厚了。', '那些騎兵從天亮就沒停過。', '最好別讓前線那些傢伙退到這裡來。'],
  },
}

export interface DialogueContext {
  townFaction: CharacterFaction
  npcRole: DialogueRole
  playerRank: CareerRank
  firstMeet?: boolean
  nextRank?: CareerRank
  promotionEligible?: boolean
  tierUnlocked?: boolean
  hasEnoughMerit?: boolean
  isOwned?: boolean
}
export type DialogueEvent = 'open' | 'product' | 'promotion' | 'promotionSuccess' | 'mission' | 'soldierFirstOutpost' | 'horsePurchaseSuccess'
export function selectTownDialogue(c: DialogueContext, event: DialogueEvent = 'open'): string {
  const catalog = CAREER_TOWN_DIALOGUE[c.townFaction], voice = catalog.speakers[c.npcRole]
  if (event === 'horsePurchaseSuccess') return catalog.horsePurchaseSuccess[c.npcRole === 'cat' ? 'cat' : 'ranger']
  if (event === 'product') return c.isOwned ? voice.alreadyOwned : !c.tierUnlocked ? voice.tierLocked : !c.hasEnoughMerit ? voice.insufficientMerit : voice.interactionOpen
  if (event === 'promotion') return c.promotionEligible && c.nextRank ? catalog.promotionEligible[c.playerRank] : catalog.promotionLocked[c.playerRank]
  if (event === 'promotionSuccess') return catalog.promotionSuccess[c.playerRank]
  if (event === 'soldierFirstOutpost') return catalog.soldierFirstOutpost
  if (event === 'mission') return catalog.missionByRank[c.playerRank]
  return [c.firstMeet ? voice.firstMeet : '', voice.greetingByRank[c.playerRank], voice.interactionOpen].filter(Boolean).join('\n\n')
}
export function formatTownDialogue(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
}
export function promotionDetails(p: CareerProfile): string {
  const next = CAREER_RANKS[CAREER_RANKS.indexOf(p.rank) + 1], merit = enlistmentMerit(p)
  return `軍階 ${p.rank} · 歷史軍功 ${p.totalMerit} · 可用軍功 ${p.availableMerit}\n本次入伍 ${merit}` + (next ? ` / ${CAREER_RANK_THRESHOLDS[next]} · 尚差 ${Math.max(0, CAREER_RANK_THRESHOLDS[next] - merit)}` : ' · 已達最高軍階')
}
/** One global speaker at a time; no per-civilian modal or save system. */
export class TownAmbientDialogue {
  private nextAt = 5
  private sequence = 0
  take(now: number, faction: CharacterFaction, rank: CareerRank): string | null {
    if (now < this.nextAt) return null
    this.nextAt = now + 12
    const catalog = CAREER_TOWN_DIALOGUE[faction], index = this.sequence++ % (catalog.ambient.length + 1)
    return index === 0 ? catalog.speakers.civilian.greetingByRank[rank] : catalog.ambient[index - 1]
  }
}
