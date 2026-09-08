import { BaseRepository } from './BaseRepository.js';

export class SettingsRepository extends BaseRepository {
  constructor() {
    super('settings');
  }

  // Configurações usam `id` como chave
  async getSetting(key, defaultValue = null) {
    const setting = await this.findById(key);
    return setting ? setting.value : defaultValue;
  }

  async setSetting(key, value) {
    const setting = await this.findById(key);
    if (setting) {
      setting.value = value;
      return await this.update(setting);
    } else {
      return await this.create({ id: key, value });
    }
  }

  async get(key, defaultValue = null) {
    return await this.getSetting(key, defaultValue);
  }

  async set(key, value) {
    return await this.setSetting(key, value);
  }
}

export const settingsRepository = new SettingsRepository();
