import { Icon } from '../icon';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ControlledTermSet } from './constraint-set';
import { constraintKind, constraintLabel, constraintUri, constraintAcronym } from './constraint-presentation';

/** Displays a draft and emits editing intents; the picker owns application and cancellation. */
@Component({
  imports: [Icon],
  selector: 'cetp-constraint-table',
  templateUrl: './constraint-table.html',
  styleUrl: './constraint-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstraintTableComponent {
  readonly set = input.required<ControlledTermSet>();
  readonly maximumTerms = input<number>();
  readonly hashes = input<readonly (string | undefined)[]>([]);
  readonly removed = output<number>();
  readonly depthChanged = output<{ index: number; depth: number }>();
  readonly applied = output<void>();
  readonly cancelled = output<void>();
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
    if (Number.isInteger(depth) && depth >= 0) this.depthChanged.emit({ index, depth });
  }
}
