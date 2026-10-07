import { LitElement } from 'lit';
import { ElementPin } from '../pin';
export interface ElementWithPinInfo extends Element {
    pinInfo?: ElementPin[];
}
/**
 * Utility element to debug the pinInfo property. Pin locations are displayed using red dots.
 * Moving your mouse over one of the red dots shows a tooltip with the pin's name.
 *
 *
 * Usage:
 * 1. Import this file in your element's story file, e.g.
 *    ```
 *    import './utils/show-pins-element';
 *    ```
 * 2. Wrap your element with the <kody-show-pins> element, e.g.
 *    ```
 *    export const HCSR04 = () => html`
 *      <kody-show-pins>
 *        <kody-hc-sr04></kody-hc-sr04>
 *      </kody-show-pins>
 *    `;
 *    ```
 */
export declare class ShowPinsElement extends LitElement {
    pinColor: string;
    elementSlot: HTMLSlotElement;
    previousSlotChild?: ElementWithPinInfo;
    get slotChild(): ElementWithPinInfo | undefined;
    private pinInfoChangeCallback;
    handleSlotChange(): void;
    render(): import("lit-html").TemplateResult<1>;
}
