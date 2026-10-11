"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatDate } from "@/lib/format";
import type { Todo } from "@/lib/operations/contracts";
import { OperationsTodoList } from "./todo-list";
import styles from "./workspace.module.css";

export function OperationsTodoPicker({
  branch,
  value,
  onChange,
}: {
  branch: string;
  value: Todo | null;
  onChange: (value: Todo | null) => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <section className={styles.todoPicker} aria-label="Liên kết To-do">
      <div className={styles.pickerSearch}>
        <Icon name="search" size={16} aria-hidden="true" />
        <input
          aria-label="Tìm To-do đang mở"
          value={search}
          maxLength={200}
          placeholder="Tìm công việc đang mở"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {value && (
        <div className={styles.pickerSelected}>
          <span>
            <Icon name="check" size={16} aria-hidden="true" /> {value.title}
          </span>
          <button
            type="button"
            title="Bỏ liên kết, tạo To-do mới"
            aria-label="Bỏ liên kết To-do"
            onClick={() => onChange(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <OperationsTodoList
        branch={branch}
        search={search}
        onlyMine={false}
        revision={null}
        renderItem={(todo) =>
          ["done", "canceled"].includes(todo.state) ? null : (
            <button
              type="button"
              className={styles.pickerItem}
              key={todo.id}
              aria-pressed={value?.id === todo.id}
              onClick={() => onChange(todo)}
            >
              <span>{todo.title}</span>
              <small>Hạn {formatDate(todo.due_at)}</small>
            </button>
          )
        }
      />
    </section>
  );
}
