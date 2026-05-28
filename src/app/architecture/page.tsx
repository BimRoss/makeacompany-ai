'use client';

import { useEffect, useState } from 'react';

export default function ArchitecturePage() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrolled > 0 ? window.scrollY / scrolled : 0;
      setScrollProgress(progress);
    };

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('scroll', handleScroll);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Animated background grid */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black to-black opacity-90" />
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, 0.05) 25%, rgba(255, 255, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.05) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, 0.05) 25%, rgba(255, 255, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.05) 76%, transparent 77%, transparent)`,
            backgroundSize: '50px 50px',
            animation: 'grid-drift 20s linear infinite',
          }}
        />

        {/* Animated aurora blobs */}
        <div className="absolute top-20 left-10 w-96 h-96 rounded-full blur-3xl opacity-20 animate-blob"
          style={{
            background: 'linear-gradient(135deg, #fbbf24, #f97316, #0ea5e9)',
            animation: 'blob-motion 8s infinite'
          }}
        />
        <div className="absolute bottom-40 right-20 w-80 h-80 rounded-full blur-3xl opacity-15 animate-blob"
          style={{
            background: 'linear-gradient(135deg, #0ea5e9, #f97316, #fbbf24)',
            animation: 'blob-motion 10s infinite 2s'
          }}
        />

        {/* Cursor spotlight */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            width: '300px',
            height: '300px',
            background: `radial-gradient(circle, rgba(251, 191, 36, 0.1) 0%, transparent 70%)`,
            left: `${mousePos.x - 150}px`,
            top: `${mousePos.y - 150}px`,
            transition: 'all 0.3s ease-out',
            filter: 'blur(40px)',
          }}
        />
      </div>

      {/* Scroll progress indicator */}
      <div
        className="fixed top-0 left-0 h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-cyan-400 z-50 transition-all"
        style={{ width: `${scrollProgress * 100}%` }}
      />

      {/* Content */}
      <div className="relative z-10">
        {/* Hero section */}
        <div className="min-h-screen flex flex-col justify-center items-center px-6 py-20">
          <div className="text-center space-y-6 animate-fade-in">
            <div className="text-sm font-light tracking-widest text-gray-500 uppercase">
              BIMROSS · ARCHITECTURE
            </div>

            <h1 className="text-6xl md:text-8xl font-bold leading-tight">
              How it&apos;s actually built
            </h1>

            <p className="text-xl md:text-2xl text-gray-400 font-light max-w-3xl mx-auto leading-relaxed">
              Claude Code on Kubernetes · one Deployment per persona · Slack as the bus · PVCs as memory
            </p>

            <div className="pt-8 flex gap-4 justify-center">
              <button className="px-8 py-3 bg-white text-black font-semibold rounded hover:shadow-lg hover:shadow-amber-500/20 transition-all duration-300 hover:scale-105">
                Learn More
              </button>
              <button className="px-8 py-3 border border-gray-700 text-white font-semibold rounded hover:border-amber-500 hover:shadow-lg hover:shadow-amber-500/10 transition-all duration-300">
                View Repo
              </button>
            </div>
          </div>
        </div>

        {/* Core idea section */}
        <div className="py-32 px-6 max-w-6xl mx-auto">
          <div className="text-sm font-light tracking-widest text-gray-500 uppercase mb-16">
            01 · THE CORE IDEA
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Card 1 */}
            <div
              className="group p-8 rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900/50 to-black hover:border-amber-500/50 transition-all duration-500"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                e.currentTarget.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(251, 191, 36, 0.1) 0%, rgba(0, 0, 0, 0.5) 100%)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '';
              }}
            >
              <h3 className="text-2xl font-bold mb-4">Deployments, not frameworks</h3>
              <p className="text-gray-400 leading-relaxed">
                Every &quot;employee&quot; is a Claude Code agent running on Kubernetes. Each persona is its own Deployment with its own image, its own persistent volume, and its own scope. There&apos;s no agent framework, no message queue, no orchestration layer.
              </p>
            </div>

            {/* Card 2 */}
            <div
              className="group p-8 rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900/50 to-black hover:border-cyan-500/50 transition-all duration-500"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                e.currentTarget.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(6, 182, 212, 0.1) 0%, rgba(0, 0, 0, 0.5) 100%)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '';
              }}
            >
              <h3 className="text-2xl font-bold mb-4">Slack is the bus</h3>
              <p className="text-gray-400 leading-relaxed">
                Channels are workspaces, threads are sessions, DMs are private chats. A Go harness holds a Socket Mode connection and spawns a fresh <code className="bg-gray-800/50 px-2 py-1 rounded text-amber-300">claude</code> process per inbound message.
              </p>
            </div>
          </div>
        </div>

        {/* Architecture blocks */}
        <div className="py-32 px-6 max-w-6xl mx-auto">
          <div className="text-sm font-light tracking-widest text-gray-500 uppercase mb-16">
            02 · THE LAYERS
          </div>

          <div className="space-y-6">
            {[
              {
                title: 'Pod Layer',
                desc: 'RKE2 cluster running Go harness + Claude containers per persona',
                accent: 'from-amber-400',
              },
              {
                title: 'Slack API',
                desc: 'Socket Mode for real-time messages, tool_calls, and reactions',
                accent: 'from-orange-500',
              },
              {
                title: 'Persistent Storage',
                desc: 'PVCs mount channel workspaces, thread sessions, and shared memory',
                accent: 'from-cyan-400',
              },
              {
                title: 'GitHub Integration',
                desc: 'PR creation, merges, and GitOps automation via gh CLI',
                accent: 'from-cyan-300',
              },
            ].map((layer, i) => (
              <div
                key={i}
                className="p-6 rounded-lg border border-gray-800 bg-gray-900/30 hover:bg-gray-900/60 transition-all duration-300 hover:border-gray-700 group"
              >
                <div className="flex items-start gap-4">
                  <div className={`text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r ${layer.accent} to-pink-500 flex-shrink-0`}>
                    0{i + 1}
                  </div>
                  <div>
                    <h4 className="text-lg font-bold mb-1 group-hover:text-amber-300 transition-colors">{layer.title}</h4>
                    <p className="text-gray-500">{layer.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features section */}
        <div className="py-32 px-6 max-w-6xl mx-auto">
          <div className="text-sm font-light tracking-widest text-gray-500 uppercase mb-16">
            03 · WHY IT WORKS
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: '⚡',
                title: 'Zero Setup',
                desc: 'Persona deploys get a fully-configured workspace on bootstrap',
              },
              {
                icon: '🧠',
                title: 'Persistent Memory',
                desc: 'Shared files and PVCs mean context survives restarts',
              },
              {
                icon: '🔄',
                title: 'Self-Healing',
                desc: 'Kubernetes restarts failed pods; Slack reconnect is built-in',
              },
              {
                icon: '🚀',
                title: 'Ship from Slack',
                desc: 'Tool calls from Claude trigger PRs, deploys, and GitOps',
              },
              {
                icon: '📊',
                title: 'Observable',
                desc: 'Every spawn logs to disk; threads are searchable sessions',
              },
              {
                icon: '🎯',
                title: 'Scoped Security',
                desc: 'Each persona only sees its own workspace and permitted APIs',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="p-8 rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900/50 to-black hover:border-gray-700 hover:from-gray-800/50 transition-all duration-300 group"
              >
                <div className="text-3xl mb-3">{feature.icon}</div>
                <h4 className="text-lg font-bold mb-2 group-hover:text-white transition-colors">{feature.title}</h4>
                <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Diagram placeholder */}
        <div className="py-32 px-6 max-w-6xl mx-auto">
          <div className="text-sm font-light tracking-widest text-gray-500 uppercase mb-16">
            04 · THE FLOW
          </div>

          <div className="relative aspect-video rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900/50 to-black p-8 overflow-hidden">
            <div className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `linear-gradient(45deg, transparent 25%, rgba(251, 191, 36, 0.1) 25%, rgba(251, 191, 36, 0.1) 50%, transparent 50%, transparent 75%, rgba(251, 191, 36, 0.1) 75%, rgba(251, 191, 36, 0.1))`,
                backgroundSize: '30px 30px',
              }}
            />
            <div className="relative h-full flex flex-col justify-center items-center text-center space-y-4">
              <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-cyan-400">
                Slack Message
              </div>
              <div className="text-gray-500">↓</div>
              <div className="text-2xl text-gray-300">Go Harness receives via Socket Mode</div>
              <div className="text-gray-500">↓</div>
              <div className="text-2xl text-gray-300">Spawn fresh <code className="bg-gray-800/50 px-3 py-1 rounded text-amber-300">claude</code> process</div>
              <div className="text-gray-500">↓</div>
              <div className="text-2xl text-gray-300">Tool calls trigger → GitHub/Slack/APIs</div>
              <div className="text-gray-500">↓</div>
              <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                Reply threads in Slack
              </div>
            </div>
          </div>
        </div>

        {/* CTA section */}
        <div className="py-32 px-6">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h2 className="text-5xl md:text-6xl font-bold">Ready to build?</h2>
            <p className="text-xl text-gray-400">
              Check out the source code, run it locally, or deploy your own persona.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <button className="px-8 py-4 bg-white text-black font-bold rounded text-lg hover:shadow-lg hover:shadow-amber-500/30 transition-all duration-300 hover:scale-105">
                View on GitHub
              </button>
              <button className="px-8 py-4 border border-white text-white font-bold rounded text-lg hover:bg-white hover:text-black transition-all duration-300">
                Get Started
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="py-16 px-6 border-t border-gray-900 text-center text-gray-600 text-sm">
          <p>© 2026 BimRoss · Deployments, not frameworks</p>
        </div>
      </div>

      <style>{`
        @keyframes grid-drift {
          0% { transform: translateY(0); }
          100% { transform: translateY(50px); }
        }

        @keyframes blob-motion {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.2; }
          50% { transform: translate(30px, -30px) scale(1.1); opacity: 0.15; }
        }

        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .animate-fade-in {
          animation: fade-in 0.8s ease-out;
        }

        .animate-blob {
          animation: blob-motion 8s infinite;
        }
      `}</style>
    </div>
  );
}
