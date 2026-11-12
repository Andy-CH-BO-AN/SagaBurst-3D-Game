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
    it(`${name}（含六技能往返與舊存檔補徒手技能）`, () => {
      const storage = new MemoryStorage(), adapter = create(storage)
      expect(adapter.save(skills)).toBe(true)
      const raw = storage.getItem(key)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw!).skills).toEqual(skills)
      expect(adapter.load()).toEqual(skills)

      // Legacy save lacking unarmed gets default Lv.1 / 0 XP without corrupting existing skills (#355/#357 merged)
      const parsed = JSON.parse(raw!)
      delete parsed.skills.unarmed
      const oldSkills = { ...parsed.skills }
      storage.setItem(key, JSON.stringify(parsed))
      const loaded = adapter.load()!
      expect(loaded).toEqual({ ...oldSkills, unarmed: { level: 1, xp: 0 } })
      expect(resolveSkillAdjustedMaxHp(200, loaded)).toBeGreaterThan(200)
    })
  }
})
