import {
  el,
  saveUiPrefs,
  setRuntimePanelWidth,
  setSidebarWidth,
  state,
} from './state_i18n.js';

function composerHeightBounds() {
  if (!el.inputBox) {
    return { min: 100, max: 420 };
  }
  const styles = window.getComputedStyle(el.inputBox);
  const min = Math.max(72, parseFloat(styles.minHeight) || el.inputBox.clientHeight || 100);
  const max = Math.max(min, parseFloat(styles.maxHeight) || Math.max(min, 420));
  return { min, max };
}

function clampComposerHeight(input: number) {
  const { min, max } = composerHeightBounds();
  const value = Number(input) || min;
  return Math.min(max, Math.max(min, value));
}

export function bindResizablePanels() {
  let resizingSidebar = false;
  let sidebarResizeStartX = 0;
  let sidebarResizeStartWidth = state.ui.sidebarWidth;
  const onSidebarPointerMove = (event) => {
    if (!resizingSidebar || state.ui.sidebarHidden) {
      return;
    }
    const delta = Number(event.clientX || 0) - sidebarResizeStartX;
    setSidebarWidth(sidebarResizeStartWidth + delta, { persist: false });
  };
  const stopSidebarResize = () => {
    if (!resizingSidebar) {
      return;
    }
    resizingSidebar = false;
    document.body.classList.remove('sidebar-resizing');
    saveUiPrefs();
    window.removeEventListener('pointermove', onSidebarPointerMove);
    window.removeEventListener('pointerup', stopSidebarResize);
    window.removeEventListener('pointercancel', stopSidebarResize);
  };
  if (el.sidebarResizer) {
    el.sidebarResizer.addEventListener('pointerdown', (event) => {
      if (state.ui.sidebarHidden) {
        return;
      }
      event.preventDefault();
      resizingSidebar = true;
      sidebarResizeStartX = Number(event.clientX || 0);
      sidebarResizeStartWidth = state.ui.sidebarWidth;
      document.body.classList.add('sidebar-resizing');
      if (typeof el.sidebarResizer.setPointerCapture === 'function') {
        try {
          el.sidebarResizer.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture may fail after rapid focus changes; global listeners still complete the drag.
        }
      }
      window.addEventListener('pointermove', onSidebarPointerMove);
      window.addEventListener('pointerup', stopSidebarResize);
      window.addEventListener('pointercancel', stopSidebarResize);
    });
  }

  let resizingRuntimePanel = false;
  let runtimeResizeStartX = 0;
  let runtimeResizeStartWidth = state.ui.runtimePanelWidth;
  const onRuntimePanelPointerMove = (event) => {
    if (!resizingRuntimePanel || state.ui.runtimePanelHidden) {
      return;
    }
    const delta = Number(event.clientX || 0) - runtimeResizeStartX;
    setRuntimePanelWidth(runtimeResizeStartWidth - delta, { persist: false });
  };
  const stopRuntimePanelResize = () => {
    if (!resizingRuntimePanel) {
      return;
    }
    resizingRuntimePanel = false;
    document.body.classList.remove('sidebar-resizing');
    saveUiPrefs();
    window.removeEventListener('pointermove', onRuntimePanelPointerMove);
    window.removeEventListener('pointerup', stopRuntimePanelResize);
    window.removeEventListener('pointercancel', stopRuntimePanelResize);
  };
  if (el.runtimeResizer) {
    el.runtimeResizer.addEventListener('pointerdown', (event) => {
      if (state.ui.runtimePanelHidden || window.innerWidth <= 1200) {
        return;
      }
      event.preventDefault();
      resizingRuntimePanel = true;
      runtimeResizeStartX = Number(event.clientX || 0);
      runtimeResizeStartWidth = state.ui.runtimePanelWidth;
      document.body.classList.add('sidebar-resizing');
      if (typeof el.runtimeResizer.setPointerCapture === 'function') {
        try {
          el.runtimeResizer.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is an optimization, not a correctness requirement for this resize flow.
        }
      }
      window.addEventListener('pointermove', onRuntimePanelPointerMove);
      window.addEventListener('pointerup', stopRuntimePanelResize);
      window.addEventListener('pointercancel', stopRuntimePanelResize);
    });
  }

  let resizingComposer = false;
  let composerResizeStartY = 0;
  let composerResizeStartHeight = 0;
  const onComposerPointerMove = (event) => {
    if (!resizingComposer || !el.inputBox || el.inputBox.disabled) {
      return;
    }
    const delta = Number(event.clientY || 0) - composerResizeStartY;
    el.inputBox.style.height = `${clampComposerHeight(composerResizeStartHeight - delta)}px`;
  };
  const stopComposerResize = () => {
    if (!resizingComposer) {
      return;
    }
    resizingComposer = false;
    document.body.classList.remove('composer-resizing');
    window.removeEventListener('pointermove', onComposerPointerMove);
    window.removeEventListener('pointerup', stopComposerResize);
    window.removeEventListener('pointercancel', stopComposerResize);
  };
  if (el.composerResizeHandle) {
    el.composerResizeHandle.addEventListener('pointerdown', (event) => {
      if (!el.inputBox || el.inputBox.disabled) {
        return;
      }
      event.preventDefault();
      resizingComposer = true;
      composerResizeStartY = Number(event.clientY || 0);
      composerResizeStartHeight = el.inputBox.getBoundingClientRect().height;
      document.body.classList.add('composer-resizing');
      if (typeof el.composerResizeHandle?.setPointerCapture === 'function') {
        try {
          el.composerResizeHandle.setPointerCapture(event.pointerId);
        } catch {
          // Textarea resizing keeps working through the window-level pointer listeners.
        }
      }
      window.addEventListener('pointermove', onComposerPointerMove);
      window.addEventListener('pointerup', stopComposerResize);
      window.addEventListener('pointercancel', stopComposerResize);
    });
  }
}
