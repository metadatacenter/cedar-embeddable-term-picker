import { Icon } from '../icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { Localizer } from '../i18n/localization';
import type { ControlledTermSet } from './constraint-set';
import { constraintKind, constraintLabel, constraintUri, constraintAcronym } from './constraint-presentation';

/** Displays a draft and emits editing intents; the picker owns application and cancellation, and their buttons. */
@Component({
  imports: [Icon, TranslatePipe],
  selector: 'cetp-constraint-table',
  templateUrl: './constraint-table.html',
  styleUrl: './constraint-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstraintTableComponent {
  protected readonly localizer = inject(Localizer);
  readonly set = input.required<ControlledTermSet>();
  readonly hashes = input<readonly (string | undefined)[]>([]);
  readonly removed = output<number>();
  readonly actionRemoved = output<number>();
  readonly depthChanged = output<{ index: number; depth: number }>();
  protected readonly constraintKind = constraintKind;
  protected readonly constraintLabel = constraintLabel;
  protected readonly constraintUri = constraintUri;
  protected readonly constraintAcronym = constraintAcronym;
  protected shortHash(id: string): string {
    return id.slice(0, 12);
  }
  protected changeDepth(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const depth = value.trim() === '' ? Number.NaN : Number(value);
    this.depthChanged.emit({ index, depth });
  }
}
