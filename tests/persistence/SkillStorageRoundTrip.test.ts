import { describe,expect,it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { SkillState } from '../../src/rpg/SkillManager'
import { DEFAULT_SAVE,SaveManager,type PlayerSaveData } from '../../src/save/SaveManager'
import { MemoryStorage } from '../helpers/memoryStorage'
import { resolveSkillAdjustedMaxHp } from '../../src/rpg/CombatSkillProgression'

interface SkillStorageAdapter {
  save(skills: SkillState): boolean
  load(): SkillState | PlayerSaveData['skills'] | undefined
}

const implementations: Array<{
  name: string
  key: string
  skills: SkillState
  create(storage: MemoryStorage): SkillStorageAdapter
}> = [
  {
    name: 'persists all six skills through Career save/reload',
    key: 'sagaburst_career_v1',
    skills: {
      unarmed: { level: 16, xp: 123 },
      blocking: { level: 12, xp: 42 },
      oneHanded: { level: 7, xp: 12 },
      twoHanded: { level: 8, xp: 23 },
      ranged: { level: 9, xp: 34 },
      mountedImpact: { level: 10, xp: 45 },
    },
    create(storage) {
      const store = new CareerProfileStore(storage)
      return {
        save(skills) {
          const profile = createCareerProfile('roman')
          profile.skills = skills
          return store.save(profile)
        },
        load: () => store.load()?.skills,
      }
    },
  },
  {
    name: 'persists all six skills through regular save/reload',
    key: 'wdyh_save_v1',
    skills: {
      unarmed: { level: 19, xp: 321 },
      blocking: { level: 11, xp: 21 },
      oneHanded: { level: 3, xp: 10 },
      twoHanded: { level: 4, xp: 20 },
      ranged: { level: 5, xp: 30 },
      mountedImpact: { level: 6, xp: 40 },
    },
    create(storage) {
      const store = new SaveManager(storage)
      return {
        save: skills => store.save({
          ...DEFAULT_SAVE,
          position: { ...DEFAULT_SAVE.position },
          inventory: { ...DEFAULT_SAVE.inventory },
          skills,
        }),
        load: () => store.load().skills,
      }
    },
  },
]

describe('Skill storage round-trip', () => {
  for (const { name, key, skills, create } of implementations) {
    it(name, () => {
      const storage = new MemoryStorage()
      expect(create(storage).save(skills)).toBe(true)
      const raw = storage.getItem(key)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw!).skills).toEqual(skills)
      expect(create(storage).load()).toEqual(skills)
    })
    it(`${name}：合法舊存檔缺少徒手技能時補 Lv.1／零 XP，不改原進度與 HP`, () => {
      const storage = new MemoryStorage(), adapter = create(storage)
      expect(adapter.save(skills)).toBe(true)
      const raw = JSON.parse(storage.getItem(key)!)
      delete raw.skills.unarmed
      const oldSkills = { ...raw.skills }
      storage.setItem(key, JSON.stringify(raw))
      const loaded = adapter.load()!
      expect(loaded).toEqual({ ...oldSkills, unarmed: { level: 1, xp: 0 } })
      expect(resolveSkillAdjustedMaxHp(200, loaded)).toBe(key === 'sagaburst_career_v1' ? 242 : 225)
    })
  }
})
