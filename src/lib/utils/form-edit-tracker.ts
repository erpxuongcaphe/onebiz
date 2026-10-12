type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function values(form: HTMLFormElement) {
  return JSON.stringify(Array.from(form.querySelectorAll<Field>("input,select,textarea")).filter(field => !field.matches("[type=submit],[type=button],[type=search],[data-unsaved-ignore]")).map(field => [field.name, field.type, field.value, field instanceof HTMLInputElement ? field.checked : null]));
}
const savedForms = new WeakMap<HTMLFormElement, string>();

/** Capture before submitting; acknowledge only after the command succeeds. */
export function captureFormSave(form: HTMLFormElement) {
  const submitted = values(form);
  return () => { savedForms.set(form, submitted); };
}

export function createFormEditTracker() {
  const baselines = new Map<HTMLFormElement, string>();
  const getForm = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest('[role="dialog"],[data-unsaved-ignore]')) return null;
    const form = target.closest("form");
    if (!form || form.method.toLowerCase() === "get" && form.hasAttribute("action")) return null;
    return form;
  };
  return {
    before(event: Event) {
      const form = getForm(event.target);
      if (form && !baselines.has(form)) baselines.set(form, values(form));
    },
    dirty() {
      for (const [form, initial] of baselines) {
        if (!form.isConnected) { baselines.delete(form); continue; }
        if (values(form) !== (savedForms.get(form) ?? initial)) return true;
      }
      return false;
    },
    clear() { baselines.clear(); },
    reset(event: Event) {
      const form = getForm(event.target);
      if (form) queueMicrotask(() => { savedForms.delete(form); baselines.set(form, values(form)); });
    },
  };
}
