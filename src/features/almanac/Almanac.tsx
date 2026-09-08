import type { RoleDef } from "@/stores/types";
import { AlmanacBody } from "./AlmanacBody";
import { Modal } from "@/components/Modal";

type AlmanacProps = {
  title: string;
  roles: RoleDef[];
  onClose: () => void;
};

export function Almanac({ title, roles, onClose }: AlmanacProps) {
  return (
    <Modal title={title} onClose={onClose} className="dialog-lg">
      <AlmanacBody roles={roles} autoFocusSearch />
    </Modal>
  );
}
