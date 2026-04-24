import path from 'node:path';
import { JsonStore } from '../utils/jsonStore.js';
import { config } from '../config/env.js';

const defaultValue = {
  users: {}
};

function createDefaultUserState() {
  return {
    stickerSets: [],
    lastConverted: null,
    pendingAction: null,
    aiVideoChargePending: null,
    chatHistory: [],
    profile: null,
    balances: {
      aiVideoTokens: config.initialAiVideoTokens
    }
  };
}

export class UserStateRepository {
  constructor() {
    this.store = new JsonStore(path.join(config.dataDir, 'users.json'), defaultValue);
  }

  async getUser(userId) {
    const state = await this.store.read();
    return state.users[String(userId)] || createDefaultUserState();
  }

  async updateUser(userId, updater) {
    return this.store.update((state) => {
      const key = String(userId);
      const current = state.users[key] || createDefaultUserState();
      state.users[key] = updater(current);
      return state;
    });
  }

  async getAllUsers() {
    const state = await this.store.read();
    return state.users;
  }

  async removeStickerSetFromAllUsers(setName) {
    return this.store.update((state) => {
      for (const key of Object.keys(state.users)) {
        const user = state.users[key];
        user.stickerSets = (user.stickerSets || []).filter((set) => set.name !== setName);
      }

      return state;
    });
  }
}
