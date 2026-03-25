/** Phase 2 fixture: spec file with TestBed for test-linkage extraction tests. */

import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { API_URL } from './tokens';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [],
      providers: [
        AuthService,
        UserService,
        { provide: API_URL, useValue: 'http://localhost:4200' },
      ],
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('isLoggedIn returns false when no token', () => {
    expect(service.isLoggedIn()).toBe(false);
  });
});
