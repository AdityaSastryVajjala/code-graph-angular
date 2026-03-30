/** Phase 2 fixture: service using @Inject(TOKEN) and inject() for DI extraction tests. */

import { Injectable, Inject, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { UserService } from './user.service';
import { API_URL } from './tokens';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly userService = inject(UserService);

  constructor(@Inject(API_URL) private apiUrl: string) {}

  login(username: string, password: string): Promise<boolean> {
    void this.userService;
    return fetch(`${this.apiUrl}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }).then((r) => r.ok);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }
}
