"use client";

import { DEFAULT_MODEL_BY_PROVIDER, type KeybindingCommand } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useDebouncedValue } from "@tanstack/react-pacer";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useAppSettings } from "../appSettings";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { cn, newCommandId, newProjectId } from "../lib/utils";
import { shortcutLabelForCommand } from "../keybindings";
import { readNativeApi } from "../nativeApi";
import { formatRelativeTime } from "../relativeTime";
import { useStore } from "../store";
import { Kbd, KbdGroup } from "./ui/kbd";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "./ui/command";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

const RECENT_THREAD_LIMIT = 12;

interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly label: string;
  readonly title: ReactNode;
  readonly description?: string;
  readonly searchText?: string;
  readonly timestamp?: string;
  readonly icon: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly title: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

const ITEM_ICON_CLASS = "size-4 text-muted-foreground/80";
const ADDON_ICON_CLASS = "size-4";

function compareThreadsByCreatedAtDesc(
  left: { id: string; createdAt: string },
  right: { id: string; createdAt: string },
): number {
  const byTimestamp = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (!Number.isNaN(byTimestamp) && byTimestamp !== 0) {
    return byTimestamp;
  }
  return right.id.localeCompare(left.id);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {children}
      <CommandPaletteDialog />
    </CommandDialog>
  );
}

function CommandPaletteDialog() {
  const open = useCommandPaletteStore((s) => s.open);
  if (!open) {
    return null;
  }

  return <OpenCommandPaletteDialog />;
}

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = query.startsWith(">");
  const isBrowsing = query.startsWith("/") || query.startsWith("~/") || query.startsWith("./") || query.startsWith("../");
  const [debouncedBrowsePath] = useDebouncedValue(query, { wait: 200 });
  const { settings } = useAppSettings();
  const { activeDraftThread, activeThread, handleNewThread, projects } = useHandleNewThread();
  const threads = useStore((store) => store.threads);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? [];
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.length > 0 ? viewStack[viewStack.length - 1]! : null;
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const { data: browseEntries = [] } = useQuery({
    queryKey: ["filesystemBrowse", debouncedBrowsePath],
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) return [];
      const result = await api.projects.browseFilesystem({ partialPath: debouncedBrowsePath });
      return result.entries;
    },
    enabled: isBrowsing && debouncedBrowsePath.length > 0,
  });

  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name] as const)),
    [projects],
  );

  const projectThreadItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      projects.map((project) => ({
        kind: "action",
        value: `new-thread-in:${project.id}`,
        label: `${project.name} ${project.cwd}`.trim(),
        title: project.name,
        description: project.cwd,
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await handleNewThread(project.id, {
            envMode: settings.defaultThreadEnvMode,
          });
        },
      })),
    [handleNewThread, projects, settings.defaultThreadEnvMode],
  );

  const projectLocalThreadItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      projects.map((project) => ({
        kind: "action",
        value: `new-local-thread-in:${project.id}`,
        label: `${project.name} ${project.cwd}`.trim(),
        title: project.name,
        description: project.cwd,
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await handleNewThread(project.id, {
            envMode: "local",
          });
        },
      })),
    [handleNewThread, projects],
  );

  const pushView = useCallback((item: CommandPaletteSubmenuItem) => {
    setViewStack((prev) => [
      ...prev,
      {
        addonIcon: item.addonIcon,
        title: item.title,
        groups: item.groups,
        ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
      },
    ]);
    setQuery(item.initialQuery ?? "");
  }, []);

  const popView = useCallback(() => {
    setViewStack((prev) => prev.slice(0, -1));
    setQuery("");
  }, []);

  const handleQueryChange = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      // Auto-exit views that were entered with an initial query (e.g. browse mode)
      // when the input is fully cleared. This unifies the exit behavior for
      // typing ~/... at root and entering via the "Add project" submenu.
      if (nextQuery === "" && currentView?.initialQuery) {
        popView();
      }
    },
    [currentView, popView],
  );

  const rootGroups = useMemo<CommandPaletteGroup[]>(() => {
    const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

    if (projects.length > 0) {
      const activeProjectId = activeThread?.projectId ?? activeDraftThread?.projectId;
      const activeProjectTitle = activeProjectId
        ? (projectTitleById.get(activeProjectId) ?? null)
        : null;

      // Quick actions: only show when there's an active thread/draft to derive the project from
      if (activeProjectTitle) {
        actionItems.push({
          kind: "action",
          value: "action:new-thread",
          label: `new thread chat create ${activeProjectTitle}`.trim(),
          title: (
            <>
              New thread in <span className="font-semibold">{activeProjectTitle}</span>
            </>
          ),
          searchText: "new thread chat create draft",
          icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
          shortcutCommand: "chat.new",
          run: async () => {
            await startNewThreadFromContext({
              activeDraftThread,
              activeThread,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
              projects,
            });
          },
        });

        actionItems.push({
          kind: "action",
          value: "action:new-local-thread",
          label: `new local thread chat create ${activeProjectTitle}`.trim(),
          title: (
            <>
              New local thread in <span className="font-semibold">{activeProjectTitle}</span>
            </>
          ),
          searchText: "new local thread chat create fresh default environment",
          icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
          shortcutCommand: "chat.newLocal",
          run: async () => {
            await startNewLocalThreadFromContext({
              activeDraftThread,
              activeThread,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
              projects,
            });
          },
        });
      }

      actionItems.push({
        kind: "submenu",
        value: "action:new-thread-in",
        label: "new thread in project",
        title: "New thread in...",
        searchText: "new thread project pick choose select",
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
        groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
      });

      actionItems.push({
        kind: "submenu",
        value: "action:new-local-thread-in",
        label: "new local thread in project",
        title: "New local thread in...",
        searchText: "new local thread project pick choose select fresh default environment",
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
        groups: [{ value: "projects", label: "Projects", items: projectLocalThreadItems }],
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:add-project",
      label: "add project folder directory browse",
      title: "Add project",
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
      groups: [],
      initialQuery: "~/",
    });

    actionItems.push({
      kind: "action",
      value: "action:settings",
      label: "settings preferences configuration keybindings",
      title: "Open settings",
      icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/settings" });
      },
    });

    const recentThreadItems = threads
      .toSorted(compareThreadsByCreatedAtDesc)
      .slice(0, RECENT_THREAD_LIMIT)
      .map<CommandPaletteActionItem>((thread) => {
        const projectTitle = projectTitleById.get(thread.projectId);
        const descriptionParts = [
          projectTitle,
          thread.branch ? `#${thread.branch}` : null,
          thread.id === activeThread?.id ? "Current thread" : null,
        ].filter(Boolean);

        return {
          kind: "action",
          value: `thread:${thread.id}`,
          label: `${thread.title} ${projectTitle ?? ""} ${thread.branch ?? ""}`.trim(),
          title: thread.title,
          description: descriptionParts.join(" · "),
          timestamp: formatRelativeTime(thread.createdAt),
          icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            await navigate({
              to: "/$threadId",
              params: { threadId: thread.id },
            });
          },
        };
      });

    const nextGroups: CommandPaletteGroup[] = [];
    if (actionItems.length > 0) {
      nextGroups.push({
        value: "actions",
        label: "Actions",
        items: actionItems,
      });
    }
    if (recentThreadItems.length > 0) {
      nextGroups.push({
        value: "recent-threads",
        label: "Recent Threads",
        items: recentThreadItems,
      });
    }
    return nextGroups;
  }, [
    activeDraftThread,
    activeThread,
    handleNewThread,
    navigate,
    projectTitleById,
    projects,
    projectLocalThreadItems,
    projectThreadItems,
    settings.defaultThreadEnvMode,
    threads,
  ]);

  const activeGroups = currentView ? currentView.groups : rootGroups;

  // All threads as searchable items (used when there's a query to search beyond the 12 recent)
  const allThreadItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      threads.toSorted(compareThreadsByCreatedAtDesc).map((thread) => {
        const projectTitle = projectTitleById.get(thread.projectId);
        const descriptionParts = [
          projectTitle,
          thread.branch ? `#${thread.branch}` : null,
          thread.id === activeThread?.id ? "Current thread" : null,
        ].filter(Boolean);

        return {
          kind: "action",
          value: `thread:${thread.id}`,
          label: `${thread.title} ${projectTitle ?? ""} ${thread.branch ?? ""}`.trim(),
          title: thread.title,
          description: descriptionParts.join(" · "),
          timestamp: formatRelativeTime(thread.createdAt),
          icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            await navigate({
              to: "/$threadId",
              params: { threadId: thread.id },
            });
          },
        };
      }),
    [activeThread, navigate, projectTitleById, threads],
  );

  const filteredGroups = useMemo(() => {
    const isActionsFilter = deferredQuery.startsWith(">");
    const searchQuery = isActionsFilter ? deferredQuery.slice(1) : deferredQuery;
    const normalizedQuery = normalizeSearchText(searchQuery);

    if (normalizedQuery.length === 0) {
      const sourceGroups = isActionsFilter
        ? activeGroups.filter((group) => group.value === "actions")
        : activeGroups;
      return sourceGroups;
    }

    // When searching at root level, replace the recent-threads group with all threads
    // and add all projects so the full dataset is searchable
    const baseGroups = isActionsFilter
      ? activeGroups.filter((group) => group.value === "actions")
      : currentView === null
        ? activeGroups.filter((group) => group.value !== "recent-threads")
        : activeGroups;

    const extraGroups: CommandPaletteGroup[] = [];
    if (currentView === null && !isActionsFilter) {
      if (projectThreadItems.length > 0) {
        extraGroups.push({
          value: "projects-search",
          label: "Projects",
          items: projectThreadItems,
        });
      }
      if (allThreadItems.length > 0) {
        extraGroups.push({
          value: "threads-search",
          label: "Threads",
          items: allThreadItems,
        });
      }
    }

    const searchableGroups = [...baseGroups, ...extraGroups];

    return searchableGroups.flatMap((group) => {
      const items = group.items.filter((item) => {
        const haystack = normalizeSearchText(
          [item.searchText ?? item.label, item.searchText ? "" : (item.description ?? "")].join(
            " ",
          ),
        );
        return haystack.includes(normalizedQuery);
      });

      if (items.length === 0) {
        return [];
      }

      return [{ value: group.value, label: group.label, items }];
    });
  }, [activeGroups, allThreadItems, currentView, deferredQuery, projectThreadItems]);

  const handleAddProject = useCallback(
    async (cwd: string) => {
      const api = readNativeApi();
      if (!api) return;
      const existing = projects.find((p) => p.cwd === cwd);
      if (existing) {
        setOpen(false);
        return;
      }
      const projectId = newProjectId();
      const segments = cwd.split(/[/\\]/);
      const title = segments.findLast(Boolean) ?? cwd;
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title,
        workspaceRoot: cwd,
        defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
        createdAt: new Date().toISOString(),
      });
      await handleNewThread(projectId, { envMode: settings.defaultThreadEnvMode }).catch(() => {});
      setOpen(false);
    },
    [handleNewThread, projects, setOpen, settings.defaultThreadEnvMode],
  );

  // Navigate into a subdirectory in browse mode
  const browseTo = useCallback(
    (name: string) => {
      const queryDir = query.replace(/[^/]*$/, ""); // e.g. "~/" or "~/projects/"
      setQuery(queryDir + name + "/");
      setBrowseGeneration((g) => g + 1);
    },
    [query],
  );

  // Navigate up one directory level in browse mode
  const browseUp = useCallback(() => {
    const trimmed = query.replace(/\/$/, "");
    const lastSlash = trimmed.lastIndexOf("/");
    if (lastSlash >= 0) {
      setQuery(trimmed.slice(0, lastSlash + 1));
      setBrowseGeneration((g) => g + 1);
    }
  }, [query]);

  // Whether to show a ".." entry (can go up if path has more than one segment)
  const canBrowseUp = isBrowsing && /\/.+\//.test(query);

  // Browse mode items rendered through the autocomplete primitive
  const browseGroups = useMemo<CommandPaletteGroup[]>(() => {
    const items: CommandPaletteActionItem[] = [];

    // ".." to go up
    if (canBrowseUp) {
      items.push({
        kind: "action",
        value: "browse:up",
        label: "..",
        title: "..",
        icon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
        keepOpen: true,
        run: async () => {
          browseUp();
        },
      });
    }

    // Directory entries
    for (const entry of browseEntries) {
      items.push({
        kind: "action",
        value: `browse:${entry.fullPath}`,
        label: entry.name,
        title: entry.name,
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        keepOpen: true,
        run: async () => {
          browseTo(entry.name);
        },
      });
    }

    return [{ value: "directories", label: "Directories", items }];
  }, [canBrowseUp, browseEntries, browseUp, browseTo]);

  const displayedGroups = isBrowsing ? browseGroups : filteredGroups;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // In browse mode, Enter with nothing highlighted submits the typed path
      if (isBrowsing && event.key === "Enter") {
        const hasHighlight = document.querySelector(
          "[data-testid='command-palette'] [data-highlighted]",
        );
        if (!hasHighlight) {
          event.preventDefault();
          void handleAddProject(query.trim());
        }
      }

      if (event.key === "Backspace" && query === "" && viewStack.length > 0) {
        event.preventDefault();
        popView();
      }
    },
    [isBrowsing, query, handleAddProject, viewStack, popView],
  );

  const executeItem = useCallback(
    (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => {
      if (item.kind === "submenu") {
        pushView(item);
        return;
      }
      if (!item.keepOpen) {
        setOpen(false);
      }
      void item.run().catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Unable to run command",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      });
    },
    [pushView, setOpen],
  );

  const inputPlaceholder = isBrowsing
    ? "Enter project path (e.g. ~/projects/my-app)"
    : currentView !== null
      ? "Search..."
      : "Search commands, projects, and threads...";

  return (
    <CommandDialogPopup
      aria-label="Command palette"
      className="overflow-hidden p-0"
      data-testid="command-palette"
    >
      <Command
        key={`${viewStack.length}-${browseGeneration}`}
        aria-label="Command palette"
        autoHighlight={isBrowsing ? false : "always"}
        mode="none"
        onValueChange={handleQueryChange}
        value={query}
      >
        <div className="relative">
          <CommandInput
            className={isBrowsing ? "pe-16" : undefined}
            placeholder={currentView !== null
              ? (isBrowsing ? "Enter path (e.g. ~/projects/my-app)" : "Search...")
              : inputPlaceholder}
            startAddon={currentView !== null ? currentView.addonIcon : (isBrowsing ? <FolderPlusIcon /> : undefined)}
            onKeyDown={handleKeyDown}
          />
          {isBrowsing ? (
            <Button
              variant="outline"
              size="xs"
              className="absolute end-2.5 top-1/2 -translate-y-1/2"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                void handleAddProject(query.trim());
              }}
            >
              Add
            </Button>
          ) : null}
        </div>
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          {displayedGroups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {isActionsOnly
                ? "No matching actions."
                : "No matching commands, projects, or threads."}
            </div>
          ) : (
            <CommandList>
              {displayedGroups.map((group) => (
                <CommandGroup items={group.items} key={group.value}>
                  <CommandGroupLabel>{group.label}</CommandGroupLabel>
                  <CommandCollection>
                    {(item) => {
                      const shortcutLabel = item.shortcutCommand
                        ? shortcutLabelForCommand(keybindings, item.shortcutCommand)
                        : null;
                      return (
                        <CommandItem
                          value={item.value}
                          className="cursor-pointer gap-2"
                          onMouseDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            executeItem(item);
                          }}
                        >
                          {item.icon}
                          {item.description ? (
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm text-foreground">{item.title}</span>
                              <span className="truncate text-muted-foreground/70 text-xs">
                                {item.description}
                              </span>
                            </span>
                          ) : (
                            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-foreground">
                              <span className="truncate">{item.title}</span>
                            </span>
                          )}
                          {item.timestamp ? (
                            <span className="min-w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70">
                              {item.timestamp}
                            </span>
                          ) : null}
                          {shortcutLabel ? (
                            <CommandShortcut>{shortcutLabel}</CommandShortcut>
                          ) : null}
                          {item.kind === "submenu" ? (
                            <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground/50" />
                          ) : null}
                        </CommandItem>
                      );
                    }}
                  </CommandCollection>
                </CommandGroup>
              ))}
            </CommandList>
          )}
        </CommandPanel>
        <CommandFooter className="gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span className={cn("text-muted-foreground/80")}>Navigate</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Enter</Kbd>
              <span className={cn("text-muted-foreground/80")}>Select</span>
            </KbdGroup>
            {currentView !== null ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Backspace</Kbd>
                <span className={cn("text-muted-foreground/80")}>Back</span>
              </KbdGroup>
            ) : null}
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span className={cn("text-muted-foreground/80")}>Close</span>
            </KbdGroup>
          </div>
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}
