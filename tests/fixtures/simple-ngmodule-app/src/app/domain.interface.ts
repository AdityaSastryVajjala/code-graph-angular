/** Phase 2 fixture: interfaces for testing IMPLEMENTS / EXTENDS extraction. */

export interface Identifiable {
  id: string;
}

export interface Named {
  name: string;
}

export interface UserModel extends Named {
  email: string;
  getDisplayName(): string;
}
