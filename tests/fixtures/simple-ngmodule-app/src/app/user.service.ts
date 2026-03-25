import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  getUser(): { name: string } {
    return { name: 'Alice' };
  }
}
