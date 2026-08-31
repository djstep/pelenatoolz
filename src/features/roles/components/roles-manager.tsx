"use client";

import { useActionState, useState } from "react";
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
  type RoleActionState,
} from "@/features/roles/actions";
import { PermissionMatrixEditor } from "@/features/roles/components/permission-matrix-editor";
import {
  buildEmptyMatrix,
  parsePermissionMatrix,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useActionToast } from "@/shared/ui/toast";

const initial: RoleActionState = {};

type RoleRow = {
  id: string;
  name: string;
  note: string | null;
  isSystem: boolean;
  permissions: unknown;
};

function RoleEditorModal({
  projectId,
  role,
  open,
  onClose,
}: {
  projectId: string;
  role?: RoleRow;
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(role);
  const bound = isEdit
    ? updateRoleAction.bind(null, projectId, role!.id)
    : createRoleAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const matrix: PermissionMatrix = role
    ? parsePermissionMatrix(role.permissions)
    : buildEmptyMatrix();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Редактирование: ${role?.name}` : "Новая роль"}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="role-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="role-form" action={action} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="name">Название *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={role?.name}
              disabled={role?.isSystem}
            />
          </div>
          <div>
            <Label htmlFor="note">Примечание</Label>
            <Input id="note" name="note" defaultValue={role?.note ?? ""} />
          </div>
        </div>
        <PermissionMatrixEditor matrix={matrix} />
      </form>
    </Modal>
  );
}

export function RolesManager({
  projectId,
  roles,
  canManage,
}: {
  projectId: string;
  roles: RoleRow[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {canManage ? (
        <Button type="button" onClick={() => setCreating(true)}>
          + Добавить роль
        </Button>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
              <th className="py-2 pr-3">Название</th>
              <th className="py-2 pr-3">Примечание</th>
              <th className="py-2 pr-3">Тип</th>
              {canManage ? <th className="py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-[var(--border)]/60">
                <td className="py-3 pr-3 font-medium">{role.name}</td>
                <td className="py-3 pr-3 text-[var(--muted-fg)]">
                  {role.note ?? "—"}
                </td>
                <td className="py-3 pr-3">
                  {role.isSystem ? "Системная" : "Пользовательская"}
                </td>
                {canManage ? (
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditing(role)}
                      >
                        Изменить
                      </Button>
                      {!role.isSystem ? (
                        <form
                          action={async () => {
                            await deleteRoleAction(projectId, role.id);
                          }}
                        >
                          <Button type="submit" variant="danger">
                            Удалить
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RoleEditorModal
        projectId={projectId}
        role={editing ?? undefined}
        open={creating || editing != null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
