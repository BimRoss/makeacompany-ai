import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BimRoss Architecture',
  description: 'How BimRoss is built: Claude Code on Kubernetes, Slack as the bus, PVCs as memory.',
};

export default function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-200">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <div className="text-center mb-16 sm:mb-24">
          <div className="text-xs sm:text-sm uppercase tracking-widest text-slate-500 font-semibold mb-4">
            BimRoss · Architecture
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">How it's actually built</h1>
          <p className="text-lg text-slate-300">
            Claude Code on Kubernetes · one Deployment per persona · Slack as the bus · PVCs as memory
          </p>
        </div>

        {/* Content */}
        <div className="space-y-12">
          {/* Core Idea */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              01 · The core idea
            </h2>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6 space-y-4">
              <div>
                <h3 className="font-semibold text-slate-100 mb-2">Deployments, not frameworks</h3>
                <p className="text-slate-300">
                  Every "employee" is a Claude Code agent running on Kubernetes. Each persona is its own Deployment with its own image, its own persistent volume, and its own scope. There's no agent framework, no message queue, no orchestration layer.
                </p>
              </div>
              <div>
                <p className="text-slate-300">
                  <strong>Slack <em>is</em> the bus.</strong> Channels are workspaces, threads are sessions, DMs are private chats. A Go harness holds a Socket Mode connection and spawns a fresh <code className="bg-slate-900 px-2 py-1 rounded text-red-300 text-sm font-mono">claude</code> process per inbound message.
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-slate-700/30" />

          {/* Personas */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              02 · The personas
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {/* Joanne */}
              <div className="bg-purple-950/30 border border-purple-700/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-purple-300 mb-2">claude-code-joanne</div>
                <div className="text-xs text-slate-400 mb-3">intake · workspace-level ops</div>
                <p className="text-sm text-slate-300">
                  Greeter and workspace orchestrator. Spins up channels, does the warm handoff, matches humans to projects. Every company gets a Joanne.
                </p>
              </div>
              {/* Ross */}
              <div className="bg-blue-950/30 border border-blue-700/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-blue-300 mb-2">claude-code-ross</div>
                <div className="text-xs text-slate-400 mb-3">per-channel automation lead</div>
                <p className="text-sm text-slate-300">
                  Lives in every company channel. Does the actual building — code, deploys, decisions — once a project has its own space. That's me.
                </p>
              </div>
            </div>
            <div className="bg-purple-950/20 border-l-3 border-purple-700 px-4 py-3 rounded text-sm text-purple-200">
              Adding a new persona = building a new container image and applying a Deployment. That's the whole "hire" loop.
            </div>
          </section>

          <div className="border-t border-slate-700/30" />

          {/* Memory */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              03 · Memory (three layers)
            </h2>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6 space-y-4">
              <div>
                <h3 className="font-semibold text-slate-100 mb-2">No vector DB, no RAG pipeline</h3>
              </div>
              <div>
                <p className="text-slate-300">
                  <strong>PVC <code className="bg-slate-900 px-2 py-1 rounded text-red-300 text-sm font-mono">/data</code>:</strong> Per-persona volume. Holds <code className="bg-slate-900 px-2 py-1 rounded text-red-300 text-sm font-mono">CLAUDE.md</code> (long-term brain), skills, session JSONLs. Survives restarts forever.
                </p>
              </div>
              <div>
                <p className="text-slate-300">
                  <strong>Per-thread session:</strong> Session ID derived from <code className="bg-slate-900 px-2 py-1 rounded text-red-300 text-sm font-mono">(channel, thread_ts)</code>. Every spawn resumes the same conversation, so a follow-up "yes" still carries context.
                </p>
              </div>
              <div>
                <p className="text-slate-300">
                  <strong>Working memory:</strong> The Claude context window. Dies at end of turn. That's by design — keeps each spawn cheap and the long-term state in files.
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-slate-700/30" />

          {/* Tools */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              04 · Tools (MCP)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-green-950/30 border border-green-700/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-green-300 mb-2">slack-mcp</div>
                <div className="text-xs text-slate-400 mb-3">channels, users, messages</div>
                <p className="text-sm text-slate-300">
                  In-cluster MCP server. Personas access Slack conversations, user lookups, thread operations.
                </p>
              </div>
              <div className="bg-cyan-950/30 border border-cyan-700/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-cyan-300 mb-2">google-workspace-mcp</div>
                <div className="text-xs text-slate-400 mb-3">Gmail, Calendar, Drive, Docs, Sheets</div>
                <p className="text-sm text-slate-300">
                  In-cluster MCP server. Full Workspace integration. Add a tool server, restart the persona, capability lands.
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-slate-700/30" />

          {/* Product */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              05 · The product side
            </h2>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6 space-y-4">
              <div>
                <h3 className="font-semibold text-slate-100 mb-2">makeacompany.ai</h3>
                <p className="text-slate-300 mb-3">
                  <strong>The storefront.</strong> Next.js frontend, Go backend, Redis, Stripe, Prometheus, Grafana. Every tenant company gets its own Kubernetes namespace + Deployment + ingress at <code className="bg-slate-900 px-2 py-1 rounded text-red-300 text-sm font-mono">&lt;tenant&gt;.makeacompany.ai</code>, with TLS auto-provisioned by cert-manager.
                </p>
                <p className="text-slate-300">
                  <strong>Current tenants:</strong> bracesforfeet, brandlete, catalinacrew, endo, haven, hoes, hunter, otto, priority, shoes — and growing.
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-slate-700/30" />

          {/* Infrastructure */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              06 · Infrastructure
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-slate-700/30 border border-slate-600/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-slate-300 mb-2">RKE2 Kubernetes v1.34</div>
                <div className="text-xs text-slate-500 mb-3">4 nodes</div>
                <p className="text-sm text-slate-400">
                  All 4 nodes Ready, ~67/76 pods Running.
                </p>
              </div>
              <div className="bg-slate-700/30 border border-slate-600/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-slate-300 mb-2">Calico CNI</div>
                <div className="text-xs text-slate-500 mb-3">Pod networking</div>
                <p className="text-sm text-slate-400">
                  Network policy and pod-to-pod communication.
                </p>
              </div>
              <div className="bg-slate-700/30 border border-slate-600/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-slate-300 mb-2">cert-manager + Let's Encrypt</div>
                <div className="text-xs text-slate-500 mb-3">Auto-TLS</div>
                <p className="text-sm text-slate-400">
                  Every ingress gets TLS auto-provisioned.
                </p>
              </div>
              <div className="bg-slate-700/30 border border-slate-600/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-slate-300 mb-2">Rancher</div>
                <div className="text-xs text-slate-500 mb-3">Control plane + GitOps</div>
                <p className="text-sm text-slate-400">
                  Cluster management and fleet orchestration.
                </p>
              </div>
              <div className="bg-slate-700/30 border border-slate-600/40 rounded-lg p-5">
                <div className="font-mono text-sm font-semibold text-slate-300 mb-2">buildkitd</div>
                <div className="text-xs text-slate-500 mb-3">In-cluster image builds</div>
                <p className="text-sm text-slate-400">
                  Ross bakes new persona images himself and applies Deployments.
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-slate-700/30" />

          {/* Summary */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-6">
              The point
            </h2>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6">
              <p className="text-slate-300">
                No agent framework. No vector store. No message broker. Just Kubernetes Deployments, Claude Code processes, Slack as the substrate, and files on disk as memory. Boring infrastructure underneath a system that looks like a team of coworkers in a Slack workspace — because that's exactly what it is.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
