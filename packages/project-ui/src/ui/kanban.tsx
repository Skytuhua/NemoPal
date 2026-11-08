// Adapted from sadmann7/diceui@048cdea5; MIT, Copyright (c) 2024 Sadman Sakib.
// Source hashes and modifications: diceui-provenance.json; license: LICENSE.diceui.md.
"use client";

import {
  type Announcements,
  closestCenter,
  closestCorners,
  type CollisionDetection,
  defaultDropAnimationSideEffects,
  DndContext,
  type DndContextProps,
  type DragCancelEvent,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  type DroppableContainer,
  getFirstCollision,
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  type AnimateLayoutChanges,
  arrayMove,
  defaultAnimateLayoutChanges,
  horizontalListSortingStrategy,
  SortableContext,
  type SortableContextProps,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "./utils";
import { Slot as SlotPrimitive } from "radix-ui";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import * as React from "react";
import * as ReactDOM from "react-dom";

// Consumer handlers run before sensors; preventDefault suppresses activation.
function composeDragListeners<T extends object>(props: T, listeners: DraggableSyntheticListeners): T {
  const combined = { ...props };
  for (const [name, listener] of Object.entries(listeners ?? {})) {
    const consumer = (props as Record<string, unknown>)[name];
    (combined as Record<string, unknown>)[name] = (event: React.SyntheticEvent) => {
      if (typeof consumer === "function") consumer(event);
      if (!event.defaultPrevented) listener(event);
    };
  }
  return combined;
}

const directions = new Set<string>([
  KeyboardCode.Down,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Left,
]);

function getIsDirectionCode(code: string): code is KeyboardCode {
  return directions.has(code);
}

const coordinateGetter: KeyboardCoordinateGetter = (event, { context }) => {
  const { active, droppableRects, droppableContainers, collisionRect } =
    context;

  if (getIsDirectionCode(event.code)) {
    event.preventDefault();

    if (!active || !collisionRect) return;

    const filteredContainers: DroppableContainer[] = [];

    for (const entry of droppableContainers.getEnabled()) {
      if (!entry || entry.disabled) continue;

      const rect = droppableRects.get(entry.id);

      if (!rect) continue;

      const data = entry.data.current;

      if (data) {
        const { type, children } = data;

        if (type === "container" && children?.length > 0) {
          if (active.data.current?.type !== "container") {
            continue;
          }
        }
      }

      switch (event.code) {
        case KeyboardCode.Down:
          if (collisionRect.top < rect.top) {
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Up:
          if (collisionRect.top > rect.top) {
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Left:
          if (collisionRect.left >= rect.left + rect.width) {
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Right:
          if (collisionRect.left + collisionRect.width <= rect.left) {
            filteredContainers.push(entry);
          }
          break;
      }
    }

    const collisions = closestCorners({
      active,
      collisionRect: collisionRect,
      droppableRects,
      droppableContainers: filteredContainers,
      pointerCoordinates: null,
    });
    const closestId = getFirstCollision(collisions, "id");

    if (closestId != null) {
      const newDroppable = droppableContainers.get(closestId);
      const newNode = newDroppable?.node.current;
      const newRect = newDroppable?.rect.current;

      if (newNode && newRect) {
        if (newDroppable.id === "placeholder") {
          return {
            x: newRect.left + (newRect.width - collisionRect.width) / 2,
            y: newRect.top + (newRect.height - collisionRect.height) / 2,
          };
        }

        if (newDroppable.data.current?.type === "container") {
          return {
            x: newRect.left + 20,
            y: newRect.top + 74,
          };
        }

        return {
          x: newRect.left,
          y: newRect.top,
        };
      }
    }
  }

  return undefined;
};

const ROOT_NAME = "Kanban";
const BOARD_NAME = "KanbanBoard";
const COLUMN_NAME = "KanbanColumn";
const COLUMN_HANDLE_NAME = "KanbanColumnHandle";
const ITEM_NAME = "KanbanItem";
const ITEM_HANDLE_NAME = "KanbanItemHandle";
const OVERLAY_NAME = "KanbanOverlay";

interface KanbanContextValue<T> {
  id: string;
  items: Record<UniqueIdentifier, T[]>;
  modifiers: DndContextProps["modifiers"];
  strategy: SortableContextProps["strategy"];
  orientation: "horizontal" | "vertical";
  activeId: UniqueIdentifier | null;
  setActiveId: (id: UniqueIdentifier | null) => void;
  getItemValue: (item: T) => UniqueIdentifier;
  flatCursor: boolean;
}

const KanbanContext = React.createContext<KanbanContextValue<unknown> | null>(
  null,
);

function useKanbanContext(consumerName: string) {
  const context = React.useContext(KanbanContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

interface GetItemValue<T> {
  /**
   * Callback that returns a unique identifier for each kanban item. Required for array of objects.
   * @example getItemValue={(item) => item.id}
   */
  getItemValue: (item: T) => UniqueIdentifier;
}

type KanbanProps<T> = Omit<DndContextProps, "collisionDetection"> &
  (T extends object ? GetItemValue<T> : Partial<GetItemValue<T>>) & {
    value: Record<UniqueIdentifier, T[]>;
    onValueChange?: (columns: Record<UniqueIdentifier, T[]>) => void;
    onMove?: (
      event: DragEndEvent & { activeIndex: number; overIndex: number },
    ) => void;
    strategy?: SortableContextProps["strategy"];
    orientation?: "horizontal" | "vertical";
    flatCursor?: boolean;
  };

function Kanban<T>(props: KanbanProps<T>) {
  const {
    value,
    onValueChange,
    modifiers,
    strategy = verticalListSortingStrategy,
    orientation = "horizontal",
    onMove,
    getItemValue: getItemValueProp,
    accessibility,
    flatCursor = false,
    onDragStart: onDragStartProp,
    onDragOver: onDragOverProp,
    onDragEnd: onDragEndProp,
    onDragCancel: onDragCancelProp,
    ...kanbanProps
  } = props;

  const id = React.useId();
  const [activeId, setActiveId] = React.useState<UniqueIdentifier | null>(null);
  const lastOverIdRef = React.useRef<UniqueIdentifier | null>(null);
  const hasMovedRef = React.useRef(false);
  const valueBeforeDragRef = React.useRef<Record<UniqueIdentifier, T[]> | null>(
    null,
  );
  const offeredPreviewRef = React.useRef<Record<UniqueIdentifier, T[]> | null>(null);

  const acceptedPreviewRef = React.useRef<Record<UniqueIdentifier, T[]> | null>(null);

  // Only a controlled acknowledgment authorizes rollback; offers may be declined.
  React.useLayoutEffect(() => {
    const original = valueBeforeDragRef.current;
    if (!original) return;
    if (value === offeredPreviewRef.current) acceptedPreviewRef.current = value;
    if (value !== original && value !== acceptedPreviewRef.current) {
      valueBeforeDragRef.current = null;
      offeredPreviewRef.current = null;
      acceptedPreviewRef.current = null;
      lastOverIdRef.current = null;
      hasMovedRef.current = false;
      setActiveId(null);
    }
  }, [value]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
    }),
  );

  const getItemValue = React.useCallback(
    (item: T): UniqueIdentifier => {
      if (typeof item === "object" && !getItemValueProp) {
        throw new Error(
          "`getItemValue` is required when using array of objects",
        );
      }
      return getItemValueProp
        ? getItemValueProp(item)
        : (item as UniqueIdentifier);
    },
    [getItemValueProp],
  );

  const itemColumns = React.useMemo(() => {
    const columns = new Map<UniqueIdentifier, string>();
    for (const [columnId, columnItems] of Object.entries(value)) {
      for (const item of columnItems) {
        columns.set(getItemValue(item), columnId);
      }
    }
    return columns;
  }, [value, getItemValue]);

  const getColumn = React.useCallback(
    (targetId: UniqueIdentifier) => {
      if (Object.hasOwn(value, targetId)) return String(targetId);
      return itemColumns.get(targetId) ?? null;
    },
    [value, itemColumns],
  );

  const collisionDetection: CollisionDetection = React.useCallback(
    (args) => {
      if (activeId !== null && Object.hasOwn(value, activeId)) {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => Object.hasOwn(value, container.id),
          ),
        });
      }

      const pointerIntersections = pointerWithin(args);
      const intersections =
        pointerIntersections.length > 0
          ? pointerIntersections
          : rectIntersection(args);
      let overId = getFirstCollision(intersections, "id");

      if (overId == null) {
        if (hasMovedRef.current) {
          lastOverIdRef.current = activeId;
        }
        return lastOverIdRef.current !== null ? [{ id: lastOverIdRef.current }] : [];
      }

      if (Object.hasOwn(value, overId)) {
        const containerItems = value[overId];
        if (containerItems && containerItems.length > 0) {
          const closestItem = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (container) =>
                container.id !== overId &&
                String(itemColumns.get(container.id)) === String(overId),
            ),
          });

          if (closestItem.length > 0) {
            overId = closestItem[0]?.id ?? overId;
          }
        }
      }

      lastOverIdRef.current = overId;
      return [{ id: overId }];
    },
    [activeId, value, itemColumns],
  );

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      onDragStartProp?.(event);
      valueBeforeDragRef.current = value;
      offeredPreviewRef.current = null;
      acceptedPreviewRef.current = null;
      lastOverIdRef.current = null;
      hasMovedRef.current = false;
      setActiveId(event.active.id);
    },
    [value, onDragStartProp],
  );

  const onDragOver = React.useCallback(
    (event: DragOverEvent) => {
      try {
        const { active, over } = event;
        if (!over || !valueBeforeDragRef.current ||
            (value !== valueBeforeDragRef.current && value !== acceptedPreviewRef.current)) return;

        const activeColumn = getColumn(active.id);
        const overColumn = getColumn(over.id);

        if (activeColumn === null || overColumn === null) return;

        if (activeColumn === overColumn) {
          const items = value[activeColumn];
          if (!items) return;

          const activeIndex = items.findIndex(
            (item) => getItemValue(item) === active.id,
          );
          const overIndex = items.findIndex(
            (item) => getItemValue(item) === over.id,
          );

          if (
            activeIndex !== -1 &&
            overIndex !== -1 &&
            activeIndex !== overIndex
          ) {
            const newColumns = { ...value };
            newColumns[activeColumn] = arrayMove(items, activeIndex, overIndex);
            offeredPreviewRef.current = newColumns;
            onValueChange?.(newColumns);
          }
        } else {
          const activeItems = value[activeColumn];
          const overItems = value[overColumn];

          if (!activeItems || !overItems) return;

          const activeIndex = activeItems.findIndex(
            (item) => getItemValue(item) === active.id,
          );

          if (activeIndex === -1) return;

          const activeItem = activeItems[activeIndex];
          if (!activeItem) return;

          const overIndex = overItems.findIndex(
            (item) => getItemValue(item) === over.id,
          );
          const activeRect = active.rect.current.translated;
          const isBelowOverItem =
            !!activeRect && activeRect.top > over.rect.top + over.rect.height;
          const insertIndex =
            overIndex === -1
              ? overItems.length
              : overIndex + (isBelowOverItem ? 1 : 0);

          const updatedItems = {
            ...value,
            [activeColumn]: activeItems.filter(
              (item) => getItemValue(item) !== active.id,
            ),
            [overColumn]: [
              ...overItems.slice(0, insertIndex),
              activeItem,
              ...overItems.slice(insertIndex),
            ],
          };

          offeredPreviewRef.current = updatedItems;
          onValueChange?.(updatedItems);
          hasMovedRef.current = true;
        }
      } finally {
        onDragOverProp?.(event);
      }
    },
    [value, getColumn, getItemValue, onValueChange, onDragOverProp],
  );

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const original = valueBeforeDragRef.current;
      const preview = acceptedPreviewRef.current;
      valueBeforeDragRef.current = null;
      offeredPreviewRef.current = null;
      acceptedPreviewRef.current = null;
      lastOverIdRef.current = null;
      hasMovedRef.current = false;
      setActiveId(null);

      try {
        if (!original || (value !== original && value !== preview)) return;
        const { active, over } = event;
        const overColumn = over ? getColumn(over.id) : null;
        if (!over || overColumn === null) {
          if (value === preview) onValueChange?.(original);
          return;
        }

        if (Object.hasOwn(original, active.id)) {
          if (!Object.hasOwn(value, active.id) || !Object.hasOwn(value, over.id)) return;
          const columns = Object.keys(value);
          const activeIndex = columns.indexOf(String(active.id));
          const overIndex = columns.indexOf(String(over.id));
          if (activeIndex === overIndex) return;
          if (onMove) {
            onMove({ ...event, activeIndex, overIndex });
          } else {
            onValueChange?.(Object.fromEntries(
              arrayMove(columns, activeIndex, overIndex).map(key => [key, value[key]!]),
            ));
          }
          return;
        }

        const originalColumn = Object.keys(original).find(key => original[key]?.some(item => getItemValue(item) === active.id));
        const activeColumn = getColumn(active.id);
        if (originalColumn === undefined || activeColumn === null) return;
        const activeIndex = original[originalColumn]!.findIndex(item => getItemValue(item) === active.id);
        let next = value;
        let destination = activeColumn;

        // An accepted controlled preview is already ordered: do not apply the drop twice.
        if (value !== preview) {
          const items = value[activeColumn]!;
          const currentIndex = items.findIndex(item => getItemValue(item) === active.id);
          const overItems = value[overColumn]!;
          const targetIndex = overItems.findIndex(item => getItemValue(item) === over.id);
          if (currentIndex < 0) return;
          if (activeColumn === overColumn) {
            if (targetIndex < 0 || currentIndex === targetIndex) return;
            next = { ...value, [activeColumn]: arrayMove(items, currentIndex, targetIndex) };
          } else {
            const below = active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height;
            const insertIndex = targetIndex < 0 ? overItems.length : targetIndex + (below ? 1 : 0);
            next = { ...value,
              [activeColumn]: items.filter(item => getItemValue(item) !== active.id),
              [overColumn]: [...overItems.slice(0, insertIndex), items[currentIndex]!, ...overItems.slice(insertIndex)],
            };
            destination = overColumn;
          }
        }
        const overIndex = next[destination]!.findIndex(item => getItemValue(item) === active.id);
        if (originalColumn === destination && activeIndex === overIndex) return;
        if (onMove) onMove({ ...event, activeIndex, overIndex });
        else if (next !== value) onValueChange?.(next);
      } finally {
        onDragEndProp?.(event);
      }
    },
    [value, getColumn, getItemValue, onValueChange, onMove, onDragEndProp],
  );

  const onDragCancel = React.useCallback(
    (event: DragCancelEvent) => {
      const original = valueBeforeDragRef.current;
      const preview = acceptedPreviewRef.current;
      valueBeforeDragRef.current = null;
      offeredPreviewRef.current = null;
      acceptedPreviewRef.current = null;
      lastOverIdRef.current = null;
      hasMovedRef.current = false;
      setActiveId(null);
      if (original && value === preview) onValueChange?.(original);
      onDragCancelProp?.(event);
    },
    [value, onValueChange, onDragCancelProp],
  );

  const announcements: Announcements = React.useMemo(
    () => ({
      onDragStart({ active }) {
        const isColumn = Object.hasOwn(value, active.id);
        const itemType = isColumn ? "column" : "item";
        const position = isColumn
          ? Object.keys(value).indexOf(String(active.id)) + 1
          : (() => {
              const column = getColumn(active.id);
              if (column === null || !value[column]) return 1;
              return (
                value[column].findIndex(
                  (item) => getItemValue(item) === active.id,
                ) + 1
              );
            })();
        const total = isColumn
          ? Object.keys(value).length
          : (() => {
              const column = getColumn(active.id);
              return column !== null ? (value[column]?.length ?? 0) : 0;
            })();

        return `Picked up ${itemType} at position ${position} of ${total}`;
      },
      onDragOver({ active, over }) {
        if (!over) return;

        const isColumn = Object.hasOwn(value, active.id);
        const itemType = isColumn ? "column" : "item";
        const position = isColumn
          ? Object.keys(value).indexOf(String(over.id)) + 1
          : (() => {
              const column = getColumn(over.id);
              if (column === null || !value[column]) return 1;
              const items = value[column];
              const targetIndex = items.findIndex(item => getItemValue(item) === over.id);
              if (targetIndex >= 0) return targetIndex + 1;
              const activeIndex = items.findIndex(item => getItemValue(item) === active.id);
              return activeIndex >= 0 ? activeIndex + 1 : items.length + 1;
            })();
        const total = isColumn
          ? Object.keys(value).length
          : (() => {
              const column = getColumn(over.id);
              return column !== null ? (value[column]?.length ?? 0) + (getColumn(active.id) !== column ? 1 : 0) : 0;
            })();

        const overColumn = getColumn(over.id);
        const activeColumn = getColumn(active.id);

        if (isColumn) {
          return `${itemType} is now at position ${position} of ${total}`;
        }

        if (activeColumn !== overColumn) {
          return `${itemType} is now at position ${position} of ${total} in ${overColumn}`;
        }

        return `${itemType} is now at position ${position} of ${total}`;
      },
      onDragEnd({ active, over }) {
        if (!over) return;

        const isColumn = Object.hasOwn(value, active.id);
        const itemType = isColumn ? "column" : "item";
        const position = isColumn
          ? Object.keys(value).indexOf(String(over.id)) + 1
          : (() => {
              const column = getColumn(over.id);
              if (column === null || !value[column]) return 1;
              const items = value[column];
              const targetIndex = items.findIndex(item => getItemValue(item) === over.id);
              if (targetIndex >= 0) return targetIndex + 1;
              const activeIndex = items.findIndex(item => getItemValue(item) === active.id);
              return activeIndex >= 0 ? activeIndex + 1 : items.length + 1;
            })();
        const total = isColumn
          ? Object.keys(value).length
          : (() => {
              const column = getColumn(over.id);
              return column !== null ? (value[column]?.length ?? 0) + (getColumn(active.id) !== column ? 1 : 0) : 0;
            })();

        const overColumn = getColumn(over.id);
        const activeColumn = getColumn(active.id);

        if (isColumn) {
          return `${itemType} was dropped at position ${position} of ${total}`;
        }

        if (activeColumn !== overColumn) {
          return `${itemType} was dropped at position ${position} of ${total} in ${overColumn}`;
        }

        return `${itemType} was dropped at position ${position} of ${total}`;
      },
      onDragCancel({ active }) {
        const isColumn = Object.hasOwn(value, active.id);
        const itemType = isColumn ? "column" : "item";
        return `Dragging was cancelled. ${itemType} was dropped.`;
      },
    }),
    [value, getColumn, getItemValue],
  );

  const contextValue = React.useMemo<KanbanContextValue<T>>(
    () => ({
      id,
      items: value,
      modifiers,
      strategy,
      orientation,
      activeId,
      setActiveId,
      getItemValue,
      flatCursor,
    }),
    [
      id,
      value,
      activeId,
      modifiers,
      strategy,
      orientation,
      getItemValue,
      flatCursor,
    ],
  );

  return (
    <KanbanContext.Provider value={contextValue as KanbanContextValue<unknown>}>
      <DndContext
        collisionDetection={collisionDetection}
        modifiers={modifiers}
        sensors={sensors}
        {...kanbanProps}
        id={id}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: `
            To pick up a kanban item or column, press space or enter.
            While dragging, use the arrow keys to move the item.
            Press space or enter again to drop the item in its new position, or press escape to cancel.
          `,
          },
          ...accessibility,
        }}
      />
    </KanbanContext.Provider>
  );
}

const KanbanBoardContext = React.createContext<boolean>(false);

interface KanbanBoardProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
  asChild?: boolean;
}

function KanbanBoard(props: KanbanBoardProps) {
  const { asChild, className, ref, onClickCapture, ...boardProps } = props;

  const context = useKanbanContext(BOARD_NAME);

  const columns = React.useMemo(() => {
    return Object.keys(context.items);
  }, [context.items]);

  const BoardPrimitive = asChild ? SlotPrimitive.Slot : "div";

  return (
    <KanbanBoardContext.Provider value={true}>
      <SortableContext
        items={columns}
        strategy={
          context.orientation === "horizontal"
            ? horizontalListSortingStrategy
            : verticalListSortingStrategy
        }
      >
        <BoardPrimitive
          aria-orientation={context.orientation}
          data-orientation={context.orientation}
          data-slot="kanban-board"
          {...boardProps}
          onClickCapture={(event) => {
            if (context.activeId !== null) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            onClickCapture?.(event);
          }}
          ref={ref}
          className={cn(
            "cn-kanban-board",
            context.orientation === "horizontal" ? "flex-row" : "flex-col",
            className,
          )}
        />
      </SortableContext>
    </KanbanBoardContext.Provider>
  );
}

interface KanbanColumnContextValue {
  id: string;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners | undefined;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  disabled?: boolean;
}

const KanbanColumnContext =
  React.createContext<KanbanColumnContextValue | null>(null);

function useKanbanColumnContext(consumerName: string) {
  const context = React.useContext(KanbanColumnContext);
  if (!context) {
    throw new Error(
      `\`${consumerName}\` must be used within \`${COLUMN_NAME}\``,
    );
  }
  return context;
}

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true });

interface KanbanColumnProps extends React.ComponentProps<"div"> {
  value: UniqueIdentifier;
  children: React.ReactNode;
  asChild?: boolean;
  asHandle?: boolean;
  disabled?: boolean;
}

function KanbanColumn(props: KanbanColumnProps) {
  const {
    value,
    asChild,
    asHandle,
    disabled,
    className,
    style,
    ref,
    id: idProp,
    ...columnProps
  } = props;

  const instanceId = React.useId();
  const id = idProp ?? instanceId;
  const context = useKanbanContext(COLUMN_NAME);
  const inBoard = React.useContext(KanbanBoardContext);
  const inOverlay = React.useContext(KanbanOverlayContext);

  if (!inBoard && !inOverlay) {
    throw new Error(
      `\`${COLUMN_NAME}\` must be used within \`${BOARD_NAME}\` or \`${OVERLAY_NAME}\``,
    );
  }

  if (value === "") {
    throw new Error(`\`${COLUMN_NAME}\` value cannot be an empty string`);
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: value,
    disabled,
    animateLayoutChanges,
  });

  const onNodeRefChange = React.useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
    },
    [setNodeRef],
  );

  const composedRef = useComposedRefs(ref, onNodeRefChange);

  const composedStyle = React.useMemo<React.CSSProperties>(() => {
    return {
      transform: CSS.Transform.toString(transform),
      transition,
      ...style,
    };
  }, [transform, transition, style]);

  const items = React.useMemo(() => {
    const columnItems = context.items[value] ?? [];
    return columnItems.map((item) => context.getItemValue(item));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- whole context would recompute items whenever activeId changes
  }, [context.items, value, context.getItemValue]);

  const columnContext = React.useMemo<KanbanColumnContextValue>(
    () => ({
      id,
      attributes,
      listeners,
      setActivatorNodeRef,
      isDragging,
      disabled,
    }),
    [id, attributes, listeners, setActivatorNodeRef, isDragging, disabled],
  );

  const ColumnPrimitive = asChild ? SlotPrimitive.Slot : "div";

  return (
    <KanbanColumnContext.Provider value={columnContext}>
      <SortableContext
        items={items}
        strategy={context.strategy}
      >
        <ColumnPrimitive
          id={id}
          data-disabled={disabled ? "" : undefined}
          data-dragging={isDragging ? "" : undefined}
          data-slot="kanban-column"
          {...composeDragListeners(columnProps, asHandle && !disabled ? listeners : undefined)}
          {...(asHandle && !disabled ? attributes : {})}
          ref={composedRef}
          style={composedStyle}
          className={cn(
            "cn-kanban-column",
            {
              "touch-none select-none": asHandle,
              "cursor-default": context.flatCursor,
              "data-dragging:cursor-grabbing": !context.flatCursor,
              "cursor-grab": !isDragging && asHandle && !context.flatCursor,
              "opacity-50": isDragging,
              "pointer-events-none opacity-50": disabled,
            },
            className,
          )}
        />
      </SortableContext>
    </KanbanColumnContext.Provider>
  );
}

interface KanbanColumnHandleProps extends React.ComponentProps<"button"> {
  asChild?: boolean;
}

function KanbanColumnHandle(props: KanbanColumnHandleProps) {
  const { asChild, disabled, className, ref, ...columnHandleProps } = props;

  const context = useKanbanContext(COLUMN_NAME);
  const columnContext = useKanbanColumnContext(COLUMN_HANDLE_NAME);

  const isDisabled = Boolean(disabled || columnContext.disabled);

  const { setActivatorNodeRef } = columnContext;

  const onActivatorNodeRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (isDisabled) return;
      setActivatorNodeRef(node);
    },
    [isDisabled, setActivatorNodeRef],
  );

  const composedRef = useComposedRefs(ref, onActivatorNodeRef);

  const HandlePrimitive = asChild ? SlotPrimitive.Slot : "button";

  return (
    <HandlePrimitive
      type="button"
      aria-controls={columnContext.id}
      data-disabled={isDisabled ? "" : undefined}
      data-dragging={columnContext.isDragging ? "" : undefined}
      data-slot="kanban-column-handle"
      {...composeDragListeners(columnHandleProps, isDisabled ? undefined : columnContext.listeners)}
      {...(isDisabled ? {} : columnContext.attributes)}
      ref={composedRef}
      className={cn(
        "cn-kanban-column-handle",
        context.flatCursor
          ? "cursor-default"
          : "cursor-grab data-dragging:cursor-grabbing",
        className,
      )}
      disabled={isDisabled}
    />
  );
}

interface KanbanItemContextValue {
  id: string;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners | undefined;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  disabled?: boolean;
}

const KanbanItemContext = React.createContext<KanbanItemContextValue | null>(
  null,
);

function useKanbanItemContext(consumerName: string) {
  const context = React.useContext(KanbanItemContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ITEM_NAME}\``);
  }
  return context;
}

interface KanbanItemProps extends React.ComponentProps<"div"> {
  value: UniqueIdentifier;
  asHandle?: boolean;
  asChild?: boolean;
  disabled?: boolean;
}

function KanbanItem(props: KanbanItemProps) {
  const {
    value,
    style,
    asHandle,
    asChild,
    disabled,
    className,
    ref,
    id: idProp,
    ...itemProps
  } = props;

  const instanceId = React.useId();
  const id = idProp ?? instanceId;
  const context = useKanbanContext(ITEM_NAME);
  const inBoard = React.useContext(KanbanBoardContext);
  const inOverlay = React.useContext(KanbanOverlayContext);

  if (!inBoard && !inOverlay) {
    throw new Error(`\`${ITEM_NAME}\` must be used within \`${BOARD_NAME}\``);
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: value, disabled });

  if (value === "") {
    throw new Error(`\`${ITEM_NAME}\` value cannot be an empty string`);
  }

  // Kept stable so React doesn't detach and reattach dnd-kit's node ref on
  // every render, which retriggers droppable measuring during a drag.
  const onNodeRef = React.useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
    },
    [setNodeRef],
  );

  const composedRef = useComposedRefs(ref, onNodeRef);

  const composedStyle = React.useMemo<React.CSSProperties>(() => {
    return {
      transform: CSS.Transform.toString(transform),
      transition,
      ...style,
    };
  }, [transform, transition, style]);

  const itemContext = React.useMemo<KanbanItemContextValue>(
    () => ({
      id,
      attributes,
      listeners,
      setActivatorNodeRef,
      isDragging,
      disabled,
    }),
    [id, attributes, listeners, setActivatorNodeRef, isDragging, disabled],
  );

  const ItemPrimitive = asChild ? SlotPrimitive.Slot : "div";

  return (
    <KanbanItemContext.Provider value={itemContext}>
      <ItemPrimitive
        id={id}
        data-disabled={disabled ? "" : undefined}
        data-dragging={isDragging ? "" : undefined}
        data-slot="kanban-item"
        {...composeDragListeners(itemProps, asHandle && !disabled ? listeners : undefined)}
        {...(asHandle && !disabled ? attributes : {})}
        ref={composedRef}
        style={composedStyle}
        className={cn(
          "cn-kanban-item",
          {
            "touch-none select-none": asHandle,
            "cursor-default": context.flatCursor,
            "data-dragging:cursor-grabbing": !context.flatCursor,
            "cursor-grab": !isDragging && asHandle && !context.flatCursor,
            "opacity-50": isDragging,
            "pointer-events-none opacity-50": disabled,
          },
          className,
        )}
      />
    </KanbanItemContext.Provider>
  );
}

interface KanbanItemHandleProps extends React.ComponentProps<"button"> {
  asChild?: boolean;
}

function KanbanItemHandle(props: KanbanItemHandleProps) {
  const { asChild, disabled, className, ref, ...itemHandleProps } = props;

  const context = useKanbanContext(ITEM_HANDLE_NAME);
  const itemContext = useKanbanItemContext(ITEM_HANDLE_NAME);

  const isDisabled = Boolean(disabled || itemContext.disabled);

  const { setActivatorNodeRef } = itemContext;

  const onActivatorNodeRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (isDisabled) return;
      setActivatorNodeRef(node);
    },
    [isDisabled, setActivatorNodeRef],
  );

  const composedRef = useComposedRefs(ref, onActivatorNodeRef);

  const HandlePrimitive = asChild ? SlotPrimitive.Slot : "button";

  return (
    <HandlePrimitive
      type="button"
      aria-controls={itemContext.id}
      data-disabled={isDisabled ? "" : undefined}
      data-dragging={itemContext.isDragging ? "" : undefined}
      data-slot="kanban-item-handle"
      {...composeDragListeners(itemHandleProps, isDisabled ? undefined : itemContext.listeners)}
      {...(isDisabled ? {} : itemContext.attributes)}
      ref={composedRef}
      className={cn(
        "cn-kanban-item-handle",
        context.flatCursor
          ? "cursor-default"
          : "cursor-grab data-dragging:cursor-grabbing",
        className,
      )}
      disabled={isDisabled}
    />
  );
}

const KanbanOverlayContext = React.createContext(false);

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.4",
      },
    },
  }),
};

function subscribe() {
  return () => {};
}

interface KanbanOverlayProps extends Omit<
  React.ComponentProps<typeof DragOverlay>,
  "children"
> {
  container?: Element | DocumentFragment | null;
  children?:
    | React.ReactNode
    | ((params: {
        value: UniqueIdentifier;
        variant: "column" | "item";
      }) => React.ReactNode);
}

function KanbanOverlay(props: KanbanOverlayProps) {
  const { container: containerProp, children, ...overlayProps } = props;

  const context = useKanbanContext(OVERLAY_NAME);

  const mounted = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const container =
    containerProp ?? (mounted ? globalThis.document?.body : null);

  if (!container) return null;

  const variant =
    context.activeId !== null && Object.hasOwn(context.items, context.activeId) ? "column" : "item";

  return ReactDOM.createPortal(
    <div className="workspace-ui" data-slot="kanban-overlay-scope" style={{ display: "contents", pointerEvents: "none" }} aria-hidden="true" inert>
    <DragOverlay
      dropAnimation={dropAnimation}
      modifiers={context.modifiers}
      className={cn(!context.flatCursor && "cursor-grabbing")}
      {...overlayProps}
    >
      <KanbanOverlayContext.Provider value={true}>
        {context.activeId !== null && children != null
          ? typeof children === "function"
            ? children({
                value: context.activeId,
                variant,
              })
            : children
          : null}
      </KanbanOverlayContext.Provider>
    </DragOverlay>
    </div>,
    container,
  );
}

export {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
  type KanbanProps,
};
