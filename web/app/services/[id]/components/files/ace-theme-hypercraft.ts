/**
 * Hypercraft 的 Ace 主题：所有颜色取自全局设计变量（globals.css 中的 --hc-code-*），
 * 因此随界面亮 / 暗色自动切换，与页面其他部分保持一致。
 */
import ace from "ace-builds/src-noconflict/ace";

const CSS = `
.ace-hypercraft {
  background-color: var(--ws-bg);
  color: var(--hc-code-fg);
}
.ace-hypercraft .ace_gutter {
  background: var(--ws-bg);
  color: var(--hc-code-gutter);
}
.ace-hypercraft .ace_gutter-active-line {
  background: transparent;
  color: var(--hc-code-fg);
}
.ace-hypercraft .ace_print-margin { width: 0; background: transparent; }
.ace-hypercraft .ace_cursor { color: var(--hc-code-fg); }
.ace-hypercraft .ace_marker-layer .ace_selection { background: var(--hc-code-selection); }
.ace-hypercraft.ace_multiselect .ace_selection.ace_start { box-shadow: 0 0 3px 0 var(--ws-bg); }
.ace-hypercraft .ace_marker-layer .ace_step { background: var(--hc-code-selection); }
.ace-hypercraft .ace_marker-layer .ace_bracket { margin: -1px 0 0 -1px; border: 1px solid var(--hc-code-gutter); }
.ace-hypercraft .ace_marker-layer .ace_active-line { background: var(--hc-code-active-line); }
.ace-hypercraft .ace_marker-layer .ace_selected-word { border: 1px solid var(--hc-code-selection); }
.ace-hypercraft .ace_invisible { color: var(--hc-code-gutter); }
.ace-hypercraft .ace_indent-guide { background: none; border-right: 1px solid var(--hc-code-indent); }
.ace-hypercraft .ace_indent-guide-active { border-right-color: var(--hc-code-gutter); }
.ace-hypercraft .ace_fold { background-color: var(--hc-code-key); border-color: var(--hc-code-fg); }
.ace-hypercraft .ace_comment { color: var(--hc-code-comment); font-style: italic; }
.ace-hypercraft .ace_meta.ace_tag,
.ace-hypercraft .ace_variable,
.ace-hypercraft .ace_variable.ace_keygroup { color: var(--hc-code-key); }
.ace-hypercraft .ace_keyword { color: var(--hc-code-punct); }
.ace-hypercraft .ace_keyword.ace_operator,
.ace-hypercraft .ace_punctuation,
.ace-hypercraft .ace_paren,
.ace-hypercraft .ace_list.ace_markup { color: var(--hc-code-punct); }
.ace-hypercraft .ace_string { color: var(--hc-code-string); }
.ace-hypercraft .ace_constant.ace_numeric { color: var(--hc-code-number); }
.ace-hypercraft .ace_constant.ace_language,
.ace-hypercraft .ace_constant.ace_language.ace_boolean,
.ace-hypercraft .ace_constant { color: var(--hc-code-boolean); }
.ace-hypercraft .ace_constant.ace_language.ace_escape { color: var(--hc-code-number); }
.ace-hypercraft .ace_support.ace_date { color: var(--hc-code-number); }
.ace-hypercraft .ace_invalid { color: var(--error-base); }
`;

let registered = false;

/** 注册 ace/theme/hypercraft（只执行一次） */
export function registerHypercraftTheme() {
  if (registered) return;
  registered = true;
  ace.define(
    "ace/theme/hypercraft",
    ["require", "exports", "module", "ace/lib/dom"],
    (require: (m: string) => { importCssString: (css: string, id: string, append?: boolean) => void }, exports: Record<string, unknown>) => {
      exports.isDark = false;
      exports.cssClass = "ace-hypercraft";
      exports.cssText = CSS;
      require("ace/lib/dom").importCssString(CSS, "ace-hypercraft", false);
    },
  );
}
