import { BaseRepository } from './BaseRepository.js';

export class CategoryRepository extends BaseRepository {
  constructor() {
    super('categories');
  }

  async list() {
    const all = await this.findAll();
    return all.filter(c => !c.deletedAt);
  }
}

export const categoryRepository = new CategoryRepository();
