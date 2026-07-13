"use client";

import * as React from "react";
import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { cn } from "@/utils/cn";

export type SearchFieldVariant = "toolbar" | "embedded";

export interface SearchFieldProps
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
	variant?: SearchFieldVariant;
	className?: string;
	inputClassName?: string;
}

/**
 * 统一搜索框：固定宽度布局，避免折叠展开时的布局抖动
 */
export const SearchField = React.forwardRef<
	HTMLInputElement,
	SearchFieldProps
>(function SearchField(
	{
		value,
		onValueChange,
		placeholder = "搜索…",
		variant = "toolbar",
		className,
		inputClassName,
		onFocus,
		onBlur,
		disabled,
		...rest
	},
	forwardedRef,
) {
	const inputRef = React.useRef<HTMLInputElement>(null);
	const [focused, setFocused] = React.useState(false);
	const hasValue = value.length > 0;

	const setRefs = (node: HTMLInputElement | null) => {
		inputRef.current = node;
		if (typeof forwardedRef === "function") {
			forwardedRef(node);
		} else if (forwardedRef) {
			forwardedRef.current = node;
		}
	};

	const handleClear = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onValueChange("");
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	return (
		<div
			className={cn(
				// 默认不写死 w-full，由调用方控制宽度，避免挤掉同排操作区
				"flex h-9 min-w-0 items-center rounded-lg border border-stroke-soft-200",
				"bg-bg-white-0 transition-[border-color,box-shadow,background-color] duration-200 ease-out",
				variant === "toolbar" && "bg-bg-weak-50/80",
				variant === "embedded" && "w-full",
				focused &&
					"border-stroke-sub-300 bg-bg-white-0 shadow-[0_0_0_2px_var(--primary-alpha-10)]",
				disabled && "pointer-events-none opacity-50",
				className,
			)}
			role="search"
		>
			<span
				className={cn(
					"flex shrink-0 items-center pl-2.5 text-text-soft-400 transition-colors duration-200",
					(focused || hasValue) && "text-text-sub-600",
				)}
			>
				<RiSearchLine className="size-4" />
			</span>
			<input
				ref={setRefs}
				type="search"
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				autoComplete="off"
				spellCheck={false}
				className={cn(
					"h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-text-strong-950 outline-none",
					"placeholder:text-text-soft-400",
					inputClassName,
				)}
				onChange={(e) => onValueChange(e.target.value)}
				onFocus={(e) => {
					setFocused(true);
					onFocus?.(e);
				}}
				onBlur={(e) => {
					setFocused(false);
					onBlur?.(e);
				}}
				{...rest}
			/>
			<button
				type="button"
				tabIndex={hasValue ? 0 : -1}
				aria-hidden={!hasValue}
				aria-label="清除搜索"
				onMouseDown={(e) => e.preventDefault()}
				onClick={handleClear}
				className={cn(
					"mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-text-soft-400",
					"transition-opacity duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950",
					hasValue ? "opacity-100" : "pointer-events-none opacity-0",
				)}
			>
				<RiCloseLine className="size-3.5" />
			</button>
		</div>
	);
});