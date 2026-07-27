import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Lyra 风格按钮：
// - 全直角（rounded-none）
// - 默认透明边框（border-transparent），hover 时显示边框（hover:border-border）
// - 基础类参考 shadcn Lyra 官方：active 下沉、xs 字号、中等字重
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-none border border-transparent bg-clip-padding text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "bg-panel-bg-alt text-text hover:bg-panel-bg",
        destructive: "bg-error text-white hover:bg-error/90",
        // 隐形边框：默认 border-transparent，hover 时显示 border-border
        outline:
          "bg-transparent text-text hover:border-border hover:bg-panel-bg-alt",
        ghost: "bg-transparent text-text hover:bg-panel-bg-alt",
        link: "text-primary underline-offset-4 hover:underline",
        // 紧凑按钮：同 outline 但更小，hover 显示边框
        compact:
          "bg-transparent text-text hover:border-border hover:bg-panel-bg-alt px-3 h-[26px] text-[11px]",
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2.5",
        lg: "h-9 px-2.5",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
