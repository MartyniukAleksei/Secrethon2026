import { useAgent } from '../features/agent/AgentContext'
import { Icon } from '../ui/Icon'

/** Secondary button that sends a prepared question to the agent. */
export function AskButton({ question, label = 'Запитати агента' }: { question: string; label?: string }) {
  const { ask } = useAgent()
  return (
    <button className="btn btn-secondary btn-sm" type="button" onClick={() => ask(question)}>
      <Icon name="spark" />
      {label}
    </button>
  )
}
