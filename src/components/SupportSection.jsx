import { useState } from 'react';
import { Bug, LifeBuoy, Sparkles } from 'lucide-react';
import SupportForm from './SupportForm';

// Contact us, under Pricing. Deliberately plain: three reasons someone might write, one form,
// one line about when to expect a reply. The support machinery behind it (tickets, markers,
// the owner area) is invisible here on purpose — a contact form that reads like an incident
// desk tells visitors to expect incidents.

const REASONS = [
  {
    icon: Sparkles,
    title: 'Feature request',
    body: 'Got an idea for something the swarm should be able to do? A new agent, a style, a shortcut, a whole new way to make a film — tell us. The best ones get built.',
  },
  {
    icon: LifeBuoy,
    title: 'Support',
    body: 'A question about a budget, a connection or a film — give us the details and we will get you moving.',
  },
  {
    icon: Bug,
    title: 'Bug reports',
    body: 'Something behaved oddly? What you did, what you expected and what happened is all we need.',
  },
];

const SupportSection = () => {
  // "Done" remounts the form so a second, unrelated message can be sent.
  const [formKey, setFormKey] = useState(0);

  return (
    <section id="support" className="relative border-t border-white/5 bg-black/20 py-20">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute right-1/4 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-purple-900/10 blur-[120px]" />
      </div>

      <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-5 lg:gap-14">
        <div className="lg:col-span-2">
          <h2 className="headline-monster headline-keyline text-3xl tracking-tight md:text-5xl">Contact us</h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Questions, ideas, or something not quite right — drop us a line and we will get back to you by email.
          </p>
          <ul className="mt-8 space-y-5">
            {REASONS.map((reason) => (
              <li key={reason.title} className="flex gap-3">
                <span className="keyline flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-600/25 text-purple-300">
                  <reason.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{reason.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{reason.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass-panel rounded-3xl p-6 md:p-8 lg:col-span-3">
          <SupportForm key={formKey} onClose={() => setFormKey((k) => k + 1)} />
        </div>
      </div>
    </section>
  );
};

export default SupportSection;
