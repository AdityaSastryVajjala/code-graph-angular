/** Phase 2 fixture: component with external template + @Input/@Output for template binding tests. */

import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { UserModel } from './domain.interface';
import { UserService } from './user.service';

@Component({
  selector: 'app-user-detail',
  templateUrl: './user-detail.component.html',
})
export class UserDetailComponent implements OnInit, UserModel {
  @Input() id: string = '';
  @Input() name: string = '';

  email: string = '';

  @Output() saved = new EventEmitter<void>();

  isLoading: boolean = false;

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    void this.userService;
  }

  getDisplayName(): string {
    return `${this.name} <${this.email}>`;
  }

  onSave(): void {
    this.saved.emit();
  }
}
