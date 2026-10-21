import { Icon } from '../icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Localizer, Message, languageTag, messageLanguage, messageOf, phrase } from '../i18n/localization';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TerminologyClient } from './terminology-client';
import { PropertyHit, PropertyHierarchy, PropertySummary, VersionInfo } from './search-types';

@Component({
  imports: [Icon, TranslatePipe],
  selector: 'cetp-property-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [attr.aria-label]="'property.details' | translate">
      @if (allowVersions() && versions().length) {
        <div class="release-toolbar">
          <span>{{ 'property.release' | translate: { release: releaseLabel() } }}</span>
          <!-- The name is the count shown, finished by hidden words, as on a result row's release count. -->
          <button
            type="button"
            class="release-toggle"
            [attr.aria-expanded]="showReleases()"
            (click)="showReleases.set(!showReleases())"
          >
            {{ 'stepper.of' | translate: { count: versions().length } }}
            <span class="sr-only">{{ localizer.plural('property.releasesOf', versions().length) }}</span>
            <span aria-hidden="true"
              ><cetp-icon size="small" [name]="showReleases() ? 'chevron-up' : 'chevron-down'"
            /></span>
          </button>
        </div>
        @if (showReleases()) {
          <div class="releases" role="group" [attr.aria-label]="'property.releases' | translate">
            @for (version of versions(); track version.id) {
              <button
                type="button"
                class="release"
                [class.active]="version.id === current().versionId"
                (click)="changeVersion(version.id!)"
              >
                <span>{{ version.declaredVersion || version.effectiveDate || version.id }}</span>
                <code>{{ version.id }}</code>
              </button>
            }
          </div>
        }
      }
      @if (loading()) {
        <p role="status">{{ 'property.reading' | translate }}</p>
      }
      @if (error(); as message) {
        <!-- A sentence the terminology server wrote is in English. -->
        <p role="alert" [attr.lang]="messageLanguage(message)">{{ localizer.say(message) }}</p>
      }
      @if (hierarchy(); as tree) {
        <!--
          The parents, the property under them and its children stand at three depths, drawn as
          indents. Each entry states its level and its place among its siblings, so the depth can be
          heard too. A set whose end has not been read has a size of -1, which means unknown.
        -->
        @let parents = tree.selected.property.parents.length;
        <div class="hierarchy-choice">
          <ol class="tree" [attr.aria-label]="'property.hierarchy' | translate">
            @for (iri of tree.selected.property.parents; track iri; let i = $index) {
              <li class="node" aria-level="1" [attr.aria-posinset]="i + 1" [attr.aria-setsize]="parents">
                <span class="twist" aria-hidden="true"><cetp-icon size="small" name="chevron-down" /></span>
                @if (ancestor(iri); as parent) {
                  <button type="button" class="term" [title]="iri" (click)="navigate(parent)">
                    {{ parent.label }}
                  </button>
                } @else {
                  <span>{{ 'property.notHeld' | translate: { iri } }}</span>
                }
              </li>
            }
            <li
              class="node self"
              [style.padding-left.rem]="parents ? 0.9 : 0"
              [attr.aria-level]="parents ? 2 : 1"
              aria-posinset="1"
              aria-setsize="1"
            >
              <span class="twist" aria-hidden="true">
                @if (tree.children.length) {
                  <cetp-icon size="small" name="chevron-down" />
                }
              </span>
              <span class="term" [title]="tree.selected.property.iri">{{ tree.selected.property.label }}</span>
            </li>
            @for (child of tree.children; track child.iri; let i = $index) {
              <li
                class="node"
                [style.padding-left.rem]="parents ? 1.8 : 0.9"
                [attr.aria-level]="parents ? 3 : 2"
                [attr.aria-posinset]="i + 1"
                [attr.aria-setsize]="more() ? -1 : tree.children.length"
              >
                <span class="twist" aria-hidden="true">
                  @if (child.hasChildren) {
                    <cetp-icon size="small" name="chevron-right" />
                  }
                </span>
                <button type="button" class="term" [title]="child.iri" (click)="navigate(child)">
                  {{ child.label }}
                </button>
              </li>
            }
            @if (more()) {
              <li class="more">
                <button type="button" class="term" [disabled]="loading()" (click)="loadMore()">
                  {{ 'property.moreChildren' | translate }}
                </button>
              </li>
            }
          </ol>
          <button type="button" class="use" [disabled]="loading() || !!error()" (click)="chosen.emit(current())">
            {{ 'common.select' | translate }}
          </button>
        </div>
        @for (literal of tree.selected.property.literals; track $index) {
          @if (isDescription(literal.predicate)) {
            <p class="description">
              <span [attr.lang]="languageTag(literal.lang)">{{ literal.value }}</span>
              @if (literal.lang) {
                ({{ literal.lang }})
              }
            </p>
          }
        }
      }
    </section>
  `,
  styleUrl: './property-detail.scss',
})
export class PropertyDetailComponent {
  private readonly client = inject(TerminologyClient);
  protected readonly localizer = inject(Localizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly languageTag = languageTag;
  protected readonly messageLanguage = messageLanguage;
  readonly hit = input.required<PropertyHit>();
  readonly allowVersions = input(true);
  readonly focused = output<PropertyHit | null>();
  readonly chosen = output<PropertyHit>();
  protected readonly current = signal<PropertyHit>(null!);
  protected readonly hierarchy = signal<PropertyHierarchy | null>(null);
  protected readonly versions = signal<readonly VersionInfo[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<Message | null>(null);
  protected readonly more = signal(false);
  protected readonly showReleases = signal(false);
  protected releaseLabel(): string {
    const version = this.versions().find((v) => v.id === this.current()?.versionId);
    return version?.declaredVersion || version?.effectiveDate || this.current()?.versionId || '';
  }
  private attempt?: AbortController;

  constructor() {
    effect((onCleanup) => {
      const hit = this.hit();
      const controller = new AbortController();
      this.versions.set([{ id: hit.versionId }]);
      if (this.allowVersions())
        void this.client
          .propertyVersions(hit.sourceAcronym, controller.signal)
          .then((versions) => {
            if (!controller.signal.aborted) this.versions.set(versions.filter((v) => v.propertiesAvailable));
          })
          .catch(() => {
            /* Current release remains usable if the release list is unavailable. */
          });
      void this.read(hit);
      onCleanup(() => {
        controller.abort();
        this.attempt?.abort();
      });
    });
  }

  protected ancestor(iri: string) {
    return this.hierarchy()?.ancestors.find((parent) => parent.iri === iri);
  }
  protected isDescription(predicate: string): boolean {
    return predicate.endsWith('#comment') || predicate.endsWith('#definition') || predicate.endsWith('/IAO_0000115');
  }
  protected navigate(property: Pick<PropertySummary, 'iri' | 'label' | 'kind' | 'obsolete'>): void {
    void this.read({
      ...this.current(),
      termIri: property.iri,
      termLabel: property.label,
      propertyKind: property.kind,
      obsolete: property.obsolete,
    });
  }
  /**
   * Reads the chosen release. The list closes and takes the pressed button with it, so focus moves
   * to the toggle that opened the list, the nearest control that remains.
   */
  protected changeVersion(versionId: string): void {
    this.showReleases.set(false);
    this.host.nativeElement.querySelector<HTMLElement>('.release-toggle')?.focus();
    void this.read({ ...this.current(), versionId });
  }

  /**
   * Reads the next children. The button is disabled while they are read and gone once there are no
   * more, and either way focus left it. Unless the author has moved it since, it returns to the
   * button while one remains, and otherwise goes to the first child that arrived, which is where
   * the reading continues.
   */
  protected async loadMore(): Promise<void> {
    const shown = this.hierarchy()?.children.length ?? 0;
    await this.read(this.current(), shown);
    afterNextRender(
      () => {
        const detail = this.host.nativeElement;
        const focused = (detail.getRootNode() as Document | ShadowRoot).activeElement;
        if (focused !== null && focused !== document.body) return;
        const more = detail.querySelector<HTMLElement>('.more button');
        const arrived = detail.querySelectorAll<HTMLElement>('.node.self ~ .node button.term')[shown];
        (more ?? arrived)?.focus();
      },
      { injector: this.injector },
    );
  }
  private async read(hit: PropertyHit, offset = 0): Promise<void> {
    this.attempt?.abort();
    const attempt = new AbortController();
    this.attempt = attempt;
    this.current.set(hit);
    this.loading.set(true);
    this.error.set(null);
    this.focused.emit(null);
    if (!offset) this.hierarchy.set(null);
    try {
      const result = await this.client.propertyHierarchy(hit, attempt.signal, offset);
      if (attempt.signal.aborted) return;
      const selected = {
        ...hit,
        termLabel: result.selected.property.label,
        obsolete: result.selected.property.obsolete,
      };
      this.current.set(selected);
      this.hierarchy.update((previous) => ({
        ...result,
        children: [...(offset ? (previous?.children ?? []) : []), ...result.children],
      }));
      this.more.set(result.children.length === 50);
      this.focused.emit(selected);
    } catch (error) {
      if (!attempt.signal.aborted) this.error.set(messageOf(error, phrase('errors.propertyUnreadable')));
    } finally {
      if (!attempt.signal.aborted) this.loading.set(false);
    }
  }
}
