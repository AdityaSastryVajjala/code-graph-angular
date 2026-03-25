import { Component, OnInit } from '@angular/core';
import { inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { UserService } from './user.service';
import { TruncatePipe } from './truncate.pipe';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [NgFor, TruncatePipe],
  template: `
    <ul>
      <li *ngFor="let user of users">{{ user | truncate }}</li>
    </ul>
  `,
})
export class UserListComponent implements OnInit {
  private userService = inject(UserService);
  users: string[] = [];

  ngOnInit(): void {
    this.users = this.userService.getUsers();
  }
}
