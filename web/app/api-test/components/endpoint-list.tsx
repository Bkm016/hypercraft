"use client";

import type { ApiKeyScope } from "@/lib/api";
import {
  AGENT_ENDPOINTS,
  type AgentEndpointDef,
} from "../agent-endpoints";

export interface EndpointListProps {
  selectedId: string;
  keyScopes: string[] | null;
  onSelect: (ep: AgentEndpointDef) => void;
}

function hasScope(keyScopes: string[] | null, scope: ApiKeyScope | null): boolean {
  if (!scope) return true;
  if (!keyScopes) return true;
  return keyScopes.includes(scope);
}

const METHOD_COLOR: Record<string, string> = {
  GET: "text-success-base",
  POST: "text-away-base",
};

export function EndpointList({
  selectedId,
  keyScopes,
  onSelect,
}: EndpointListProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {AGENT_ENDPOINTS.map((ep) => {
        const allowed = hasScope(keyScopes, ep.scope);
        const active = selectedId === ep.id;
        return (
          <button
            key={ep.id}
            type="button"
            disabled={!allowed}
            onClick={() => onSelect(ep)}
            className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition ${
              active
                ? "bg-bg-weak-50 ring-1 ring-inset ring-stroke-soft-200"
                : "hover:bg-bg-weak-50"
            } ${!allowed ? "cursor-not-allowed opacity-40" : ""}`}
            title={
              !allowed && ep.scope
                ? `当前 Key 无 ${ep.scope} scope`
                : ep.note
            }
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-10 shrink-0 font-mono text-[11px] font-semibold ${METHOD_COLOR[ep.method] || ""}`}
              >
                {ep.method}
              </span>
              <span className="truncate font-mono text-xs text-text-strong-950">
                {ep.path}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-12">
              <span className="truncate text-[11px] text-text-soft-400">
                {ep.note}
              </span>
              {ep.scope && (
                <span className="shrink-0 rounded bg-bg-weak-50 px-1.5 py-0.5 font-mono text-[10px] text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200">
                  {ep.scope}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
