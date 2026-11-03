import { Button, Modal } from 'antd'
import DictionaryPanel from './DictionaryPanel'
import { useTargetEditLock } from '../TargetEditScope'

export default function DictionaryManager({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }): JSX.Element {
  useTargetEditLock(open)
  return <Modal title="字典库" width={1000} open={open} onCancel={onClose} destroyOnHidden
    className="parameter-dictionary-manager" footer={<Button onClick={onClose}>关闭</Button>}>
    <DictionaryPanel projectId={projectId} />
  </Modal>
}
