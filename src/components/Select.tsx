import { t } from "../../shared/i18n";
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

interface Item {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
interface Group {
  label?: ReactNode;
  items: Item[];
}
function groups(children: ReactNode): Group[] {
  const result: Group[] = [];
  const visit = (nodes: ReactNode, target?: Group) =>
    Children.forEach(nodes, (node) => {
      if (
        !isValidElement<{
          value?: string;
          label?: ReactNode;
          disabled?: boolean;
          children?: ReactNode;
        }>(node)
      )
        return;
      if (node.type === Fragment) visit(node.props.children, target);
      else if (node.type === "optgroup") {
        const group: Group = { label: node.props.label, items: [] };
        result.push(group);
        visit(node.props.children, group);
      } else if (node.type === "option") {
        const last = result.at(-1);
        const destination = target ??
          (last?.label === undefined ? last : undefined) ?? { items: [] };
        if (!result.includes(destination)) result.push(destination);
        destination.items.push({
          value: String(node.props.value ?? ""),
          label: node.props.children ?? node.props.label ?? node.props.value,
          disabled: node.props.disabled,
        });
      }
    });
  visit(children);
  return result;
}
export function Select({
  value,
  children,
  onValueChange,
  disabled,
  className = "",
  onCloseFocus,
  ...props
}: {
  value: string;
  children: ReactNode;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label": string;
  onCloseFocus?: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const options = groups(children),
    placeholder = options
      .flatMap((group) => group.items)
      .find((item) => item.value === "")?.label;
  return (
    <Primitive.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      open={open && !disabled}
      onOpenChange={setOpen}
    >
      <Primitive.Trigger
        {...props}
        type="button"
        className={"custom-select-trigger " + className}
        data-value={value}
        ref={trigger}
      >
        <Primitive.Value placeholder={placeholder ?? t("请选择…")} />
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={14} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal
        container={trigger.current?.closest("dialog") ?? undefined}
      >
        <Primitive.Content
          className="select-content"
          position="popper"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (onCloseFocus) {
              event.preventDefault();
              if (trigger.current?.isConnected) onCloseFocus();
            }
          }}
        >
          <Primitive.Viewport className="select-viewport">
            {options.map((group, index) => (
              <Primitive.Group key={index}>
                {group.label !== undefined && (
                  <Primitive.Label className="select-group-label">
                    {group.label}
                  </Primitive.Label>
                )}
                {group.items
                  .filter((item) => item.value !== "")
                  .map((item) => (
                    <Primitive.Item
                      key={item.value}
                      value={item.value}
                      disabled={item.disabled}
                      className="select-option"
                      data-value={item.value}
                    >
                      <Primitive.ItemText>{item.label}</Primitive.ItemText>
                      <Primitive.ItemIndicator className="select-check">
                        <Check size={14} />
                      </Primitive.ItemIndicator>
                    </Primitive.Item>
                  ))}
              </Primitive.Group>
            ))}
            {!options.some((group) =>
              group.items.some((item) => item.value !== ""),
            ) && <div className="select-empty">{t("暂无可选项")}</div>}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
