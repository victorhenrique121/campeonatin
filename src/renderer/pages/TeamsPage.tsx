import { Shield } from "lucide-react";
import type { Team } from "../../shared/models";

export function TeamsPage({ teams }: { teams: Team[] }) {
  return (
    <>
      <section className="page-title">
        <div>
          <p>CATÁLOGO</p>
          <h1>Times</h1>
        </div>
      </section>
      <div className="team-directory">
        <div className="team-grid">
          {teams.map((t) => (
            <article className="team-card" key={t.id}>
              <i>
                <Shield size={24} />
              </i>
              <div>
                <b>{t.name}</b>
                <small>
                  {t.league} · {t.country}
                </small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
