import { Icon } from '../icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';
import { Localizer } from '../i18n/localization';
import type { ControlledTermSet } from './constraint-set';
import { constraintKind, constraintLabel, constraintUri, constraintAcronym } from './constraint-presentation';

/** Whatever a keyboard can reach, in the order it reaches it. */
const CONTROLS = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]';

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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
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

  /**
   * Removes a constraint, and gives focus somewhere to go.
   *
   * The pressed button leaves with its row when the row is the last one, and focus then fell to the
   * page. It moves to the nearest control that remains: the remove button now in the row's place,
   * else the one above it, else the first control after the constraints.
   */
  protected removeConstraint(index: number): void {
    this.removed.emit(index);
    this.focusAfterRender(() => {
      const table = this.host.nativeElement.querySelector('table');
      return this.nearest('.constraint-row-actions button', index) ?? (table ? this.firstAfter(table) : null);
    });
  }

  /**
   * Removes a saved action, and gives focus somewhere to go, by the same rule. The last action takes
   * the list with it, and the control above the list is the last constraint's remove button.
   */
  protected removeAction(index: number): void {
    this.actionRemoved.emit(index);
    this.focusAfterRender(
      () =>
        this.nearest('.saved-actions button', index) ??
        this.nearest('.constraint-row-actions button', Infinity) ??
        this.firstAfter(this.host.nativeElement),
    );
  }

  private focusAfterRender(target: () => HTMLElement | null): void {
    afterNextRender(() => target()?.focus(), { injector: this.injector });
  }

  /** The control at a position in a list, or the last one when the list has grown shorter than that. */
  private nearest(selector: string, index: number): HTMLElement | null {
    const controls = this.host.nativeElement.querySelectorAll<HTMLElement>(selector);
    return controls.length ? controls[Math.min(index, controls.length - 1)] : null;
  }

  /** The first control a keyboard reaches after an element, anywhere in the picker. */
  private firstAfter(element: Element): HTMLElement | null {
    const root = element.getRootNode() as ParentNode;
    return (
      [...root.querySelectorAll<HTMLElement>(CONTROLS)].find(
        (control) =>
          !element.contains(control) &&
          element.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING &&
          control.getClientRects().length > 0,
      ) ?? null
    );
  }
}
