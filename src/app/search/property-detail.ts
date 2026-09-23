import { Icon } from '../icon';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { TerminologyClient } from './terminology-client';
import { PropertyHit, PropertyHierarchy, PropertySummary, VersionInfo } from './search-types';

@Component({
  imports: [Icon],
  selector: 'cetp-property-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Property details">
      @if (allowVersions() && versions().length) {
        <div class="release-toolbar">
          <span>Release {{ releaseLabel() }}</span>
          <button
            type="button"
            class="release-toggle"
            [attr.aria-expanded]="showReleases()"
            aria-label="Property ontology releases"
            (click)="showReleases.set(!showReleases())"
          >
            of {{ versions().length }}
            <span aria-hidden="true"
              ><cetp-icon size="small" [name]="showReleases() ? 'chevron-up' : 'chevron-down'"
            /></span>
          </button>
        </div>
        @if (showReleases()) {
          <div class="releases" aria-label="Property ontology releases">
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
        <p role="status">Reading property…</p>
      }
      @if (error(); as message) {
        <p role="alert">{{ message }}</p>
      }
      @if (hierarchy(); as tree) {
        <div class="hierarchy-choice">
          <ol class="tree" aria-label="Property hierarchy">
            @for (iri of tree.selected.property.parents; track iri) {
              <li class="node">
                <span class="twist" aria-hidden="true"><cetp-icon size="small" name="chevron-down" /></span>
                @if (ancestor(iri); as parent) {
                  <button type="button" class="term" [title]="iri" (click)="navigate(parent)">
                    {{ parent.label }}
                  </button>
                } @else {
                  <span class="missing">{{ iri }} (not held in this snapshot)</span>
                }
              </li>
            }
            <li class="node self" [style.padding-left.rem]="tree.selected.property.parents.length ? 0.9 : 0">
              <span class="twist" aria-hidden="true">
                @if (tree.children.length) {
                  <cetp-icon size="small" name="chevron-down" />
                }
              </span>
              <span class="term" [title]="tree.selected.property.iri">{{ tree.selected.property.label }}</span>
            </li>
            @for (child of tree.children; track child.iri) {
              <li class="node" [style.padding-left.rem]="tree.selected.property.parents.length ? 1.8 : 0.9">
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
              <li>
                <button type="button" class="term" [disabled]="loading()" (click)="loadMore()">More children</button>
              </li>
            }
          </ol>
          <button type="button" class="use" [disabled]="loading() || !!error()" (click)="chosen.emit(current())">
            Select
          </button>
        </div>
        @for (literal of tree.selected.property.literals; track $index) {
          @if (isDescription(literal.predicate)) {
            <p class="description">
              {{ literal.value }}
              @if (literal.lang) {
                ({{ literal.lang }})
              }
            </p>
          }
        }
      }
    </section>
  `,
  styles: `
    @use '@org.metadatacenter/cedar-design-tokens/tokens' as tokens;
    :host {
      display: block;
      grid-column: 1 / -1;
      min-width: 0;
      padding: 6px 8px;
    }
    button {
      font: inherit;
      cursor: pointer;
    }
    p {
      margin: 4px 0;
    }
    .release-toolbar {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 8px;
      font-size: var(--cetp-font-size-small);
      color: var(--cetp-color-muted);
      margin-bottom: 4px;
    }
    .release-toggle {
      border: 0;
      background: transparent;
      color: var(--cetp-color-primary);
      padding: 0 4px;
    }
    .releases {
      padding: 4px;
      background: var(--cetp-color-tint);
    }
    .release {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 4px 8px;
      border: 0;
      background: transparent;
      text-align: left;
    }
    .release.active {
      background: var(--cetp-color-surface);
    }
    code {
      overflow-wrap: anywhere;
    }
    .hierarchy-choice {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
    }
    .tree {
      list-style: none;
      margin: 0;
      padding: 4px 6px;
      max-height: 14rem;
      overflow: auto;
      background: white;
      border: 1px solid var(--cetp-color-border);
      border-radius: 3px;
    }
    .node {
      display: flex;
      align-items: baseline;
      gap: 3px;
    }
    .twist {
      flex: 0 0 tokens.$icon-size-small;
      color: var(--cetp-color-primary);
      font-size: 0.85em;
    }
    .term {
      font: inherit;
      border: 0;
      background: transparent;
      text-align: left;
      color: inherit;
      padding: 0 2px;
      overflow-wrap: anywhere;
    }
    button.term:hover {
      background: var(--cetp-color-tint);
    }
    .self .term {
      background: var(--cetp-color-tint);
      color: var(--cetp-color-heading);
      font-weight: 500;
    }
    .use {
      background: var(--cetp-color-primary);
      color: var(--cetp-color-on-primary);
      padding: 4px 10px;
      border: 0;
      border-radius: 3px;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .description {
      font-size: var(--cetp-font-size-small);
      color: var(--cetp-color-muted);
      overflow-wrap: anywhere;
    }
    [role='alert'] {
      color: tokens.$color-warn;
    }
  `,
})
export class PropertyDetailComponent {
  private readonly client = inject(TerminologyClient);
  readonly hit = input.required<PropertyHit>();
  readonly allowVersions = input(true);
  readonly focused = output<PropertyHit | null>();
  readonly chosen = output<PropertyHit>();
  protected readonly current = signal<PropertyHit>(null!);
  protected readonly hierarchy = signal<PropertyHierarchy | null>(null);
  protected readonly versions = signal<readonly VersionInfo[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
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
  protected changeVersion(versionId: string): void {
    this.showReleases.set(false);
    void this.read({ ...this.current(), versionId });
  }
  protected loadMore(): void {
    void this.read(this.current(), this.hierarchy()?.children.length ?? 0);
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
      if (!attempt.signal.aborted)
        this.error.set(error instanceof Error ? error.message : 'Could not read this property.');
    } finally {
      if (!attempt.signal.aborted) this.loading.set(false);
    }
  }
}
