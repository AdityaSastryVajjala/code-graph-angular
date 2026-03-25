import { Component, OnInit } from '@angular/core';
import { UserService } from './user.service';

@Component({
  selector: 'app-user',
  template: `
    <app-header></app-header>
    <div highlight>
      <p>{{ user?.name | truncate }}</p>
    </div>
  `,
})
export class UserComponent implements OnInit {
  user: { name: string } | null = null;

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    this.user = this.userService.getUser();
  }
}
