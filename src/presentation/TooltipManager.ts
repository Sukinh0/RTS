export interface TooltipContent { title: string; description: string }

/** Small delegated tooltip with delayed display, keyboard focus support and viewport clamping. */
export class TooltipManager {
  private readonly tooltip: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private currentTarget: HTMLElement | null = null;
  private timer: number | null = null;
  private pointer = { x: 0, y: 0 };

  constructor(private readonly root: Document = document) {
    this.tooltip = root.querySelector<HTMLElement>('#game-tooltip')!;
    this.title = this.tooltip.querySelector('strong')!;
    this.description = this.tooltip.querySelector('span')!;
    root.addEventListener('pointerover', this.onPointerOver);
    root.addEventListener('pointermove', this.onPointerMove, { passive: true });
    root.addEventListener('pointerout', this.onPointerOut);
    root.addEventListener('focusin', this.onFocusIn);
    root.addEventListener('focusout', this.onFocusOut);
  }

  destroy(): void {
    this.clearTimer();
    this.root.removeEventListener('pointerover', this.onPointerOver);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerout', this.onPointerOut);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
  }

  showAt(title: string, description: string, x: number, y: number): void {
    this.clearTimer();
    this.currentTarget = null;
    this.title.textContent = title;
    this.description.textContent = description;
    this.tooltip.hidden = false;
    this.place(x, y);
  }

  hideAt(): void {
    if (this.currentTarget === null) this.tooltip.hidden = true;
  }

  private onPointerOver = (event: PointerEvent): void => {
    const target = this.findTarget(event.target);
    if (!target || target === this.currentTarget) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    this.schedule(target);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.currentTarget) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (!this.tooltip.hidden) this.place(this.pointer.x, this.pointer.y);
  };

  private onPointerOut = (event: PointerEvent): void => {
    const target = this.findTarget(event.target);
    if (!target || target !== this.currentTarget) return;
    const next = this.findTarget(event.relatedTarget);
    if (next === target) return;
    this.hide();
  };

  private onFocusIn = (event: FocusEvent): void => {
    const target = this.findTarget(event.target);
    if (!target) return;
    this.schedule(target, true);
  };

  private onFocusOut = (event: FocusEvent): void => {
    const next = this.findTarget(event.relatedTarget);
    if (next !== this.currentTarget) this.hide();
  };

  private findTarget(value: EventTarget | null): HTMLElement | null {
    return value instanceof Element ? value.closest<HTMLElement>('[data-tooltip-title][data-tooltip-description]') : null;
  }

  private schedule(target: HTMLElement, focus = false): void {
    this.clearTimer();
    this.currentTarget = target;
    this.timer = window.setTimeout(() => {
      this.title.textContent = target.dataset.tooltipTitle ?? '';
      this.description.textContent = target.dataset.tooltipDescription ?? '';
      this.tooltip.hidden = false;
      if (focus) {
        const rect = target.getBoundingClientRect();
        this.place(rect.left + rect.width / 2, rect.bottom);
      } else this.place(this.pointer.x, this.pointer.y);
      this.timer = null;
    }, focus ? 120 : 190);
  }

  private place(x: number, y: number): void {
    const margin = 12;
    const gap = 14;
    const rect = this.tooltip.getBoundingClientRect();
    let left = x + gap;
    let top = y + gap;
    if (left + rect.width > window.innerWidth - margin) left = x - rect.width - gap;
    if (top + rect.height > window.innerHeight - margin) top = y - rect.height - gap;
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hide(): void {
    this.clearTimer();
    this.currentTarget = null;
    this.tooltip.hidden = true;
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
