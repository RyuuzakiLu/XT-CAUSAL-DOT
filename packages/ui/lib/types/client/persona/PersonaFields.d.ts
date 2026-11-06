import { type ReactNode } from 'react';
import { type PersonaGender } from './persona-api.ts';
export declare function Field({ label, note, children }: {
    label: string;
    note?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
export declare function TextField({ label, note, value, onChange, placeholder, max, autoFocus }: {
    label: string;
    note?: ReactNode;
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    max: number;
    autoFocus?: boolean;
}): import("react").JSX.Element;
export declare function GenderField({ value, onChange }: {
    value: PersonaGender | '';
    onChange(value: PersonaGender): void;
}): import("react").JSX.Element;
export declare function BriefField({ value, onChange, label, note }: {
    value: string;
    onChange(value: string): void;
    label?: string;
    note?: string;
}): import("react").JSX.Element;
export declare function ExpandedField({ value, onChange, name, note }: {
    value: string;
    onChange(value: string): void;
    name: string;
    note?: string;
}): import("react").JSX.Element;
export declare function Spinner(): import("react").JSX.Element;
export declare function Emblem(): import("react").JSX.Element;
