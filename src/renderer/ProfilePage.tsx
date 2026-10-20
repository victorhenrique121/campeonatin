import { useEffect, useState } from "react";
import { CheckCircle2, Gamepad2, Pencil, Trophy, UserRound } from "lucide-react";
import type { UserProfile } from "../shared/api";
import type { Dashboard } from "../shared/models";
import "./styles/profile.css";

type ProfilePageProps = {
  dashboard: Dashboard;
  onEditProfile: () => void;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarSrc(profile: UserProfile): string | null {
  if (!profile.avatarUrl) return null;
  const separator = profile.avatarUrl.includes("?") ? "&" : "?";
  return `${profile.avatarUrl}${separator}v=${encodeURIComponent(profile.updatedAt)}`;
}

function formatMemberSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return String(date.getFullYear());
}

export function ProfilePage({ dashboard, onEditProfile }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    void window.arena
      .getProfile()
      .then((value) => {
        if (!active) return;
        setProfile(value);
        setAvatarFailed(false);
      })
      .catch((reason) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Não foi possível carregar seu perfil.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <section className="page profile-page">
        <div className="profile-state">
          <div className="profile-spinner" aria-hidden="true" />
          <h1>Carregando perfil...</h1>
          <p>Buscando seus dados no Supabase.</p>
        </div>
      </section>
    );
  }

  if (error || !profile) {
    return (
      <section className="page profile-page">
        <div className="profile-state profile-state-error">
          <div className="profile-state-icon">
            <UserRound size={22} />
          </div>
          <h1>Não foi possível carregar seu perfil</h1>
          <p>{error || "Os dados do perfil não foram encontrados."}</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  const avatarSrc = getAvatarSrc(profile);
  const showAvatar = Boolean(avatarSrc) && !avatarFailed;
  const totalGoals = dashboard.statistics?.goalTrend.reduce(
    (total, point) => total + point.goalsFor + point.goalsAgainst,
    0,
  ) ?? 0;
  const decisiveWins = dashboard.ranking.reduce(
    (total, row) => total + row.wins,
    0,
  );
  const arenaStats = [
    { label: "Partidas", value: dashboard.matches },
    { label: "Gols", value: totalGoals },
    { label: "Vitórias", value: decisiveWins },
    { label: "Jogadores", value: dashboard.players },
  ];

  return (
    <section className="page profile-page">
      <header className="profile-header">
        <div>
          <span className="profile-eyebrow">CONTA</span>
          <h1>Meu perfil</h1>
          <p>Visualize as informações públicas da sua conta no FC Arena.</p>
        </div>

        <button
          type="button"
          className="profile-edit-button"
          onClick={onEditProfile}
        >
          <Pencil size={16} />
          Editar perfil
        </button>
      </header>

      <div className="profile-grid">
        <article className="profile-card profile-identity-card">
          <div className="profile-avatar-large">
            {showAvatar ? (
              <img
                src={avatarSrc!}
                alt={`Avatar de ${profile.displayName}`}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span>{getInitials(profile.displayName)}</span>
            )}
          </div>

          <div className="profile-identity">
            <h2>{profile.displayName}</h2>

            <p className="profile-username">
              {profile.username ? (
                <span>@{profile.username}</span>
              ) : (
                <span className="profile-username-empty">
                  Defina seu username em Configurações
                </span>
              )}
            </p>

            <p className="profile-bio">
              {profile.bio?.trim() || "Nenhuma bio definida."}
            </p>
          </div>
        </article>

        <article className="profile-card">
          <div className="profile-card-heading">
            <span className="profile-card-label">CONTA</span>
            <UserRound size={19} />
          </div>

          <div className="profile-details">
            <div className="profile-detail-row">
              <span>E-mail</span>
              <div className="profile-email-value">
                <strong>{profile.email}</strong>
                {profile.emailConfirmedAt ? (
                  <span className="profile-verified-badge">
                    <CheckCircle2 size={14} />
                    E-mail verificado
                  </span>
                ) : (
                  <span className="profile-unverified-badge">
                    E-mail não verificado
                  </span>
                )}
              </div>
            </div>

            <div className="profile-detail-row">
              <span>Membro desde</span>
              <strong>{formatMemberSince(profile.createdAt)}</strong>
            </div>
          </div>
        </article>

        <article className="profile-card profile-stat-card">
          <div className="profile-card-heading">
            <span className="profile-card-label">ESTATÍSTICAS DA ARENA</span>
            <Trophy size={19} />
          </div>

          <div className="profile-stats-grid">
            {arenaStats.map((stat) => (
              <div key={stat.label} className="profile-arena-stat">
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
          <p className="profile-stat-context">Dados gerais da sala atual.</p>
        </article>

        <article className="profile-card profile-games-card">
          <div className="profile-card-heading">
            <span className="profile-card-label">JOGOS</span>
            <Gamepad2 size={19} />
          </div>

          <ul className="profile-games-list">
            <li><strong>eFootball</strong><span>📱 Mobile · 💻 Desktop · 🎮 PSN · Xbox · Nintendo</span></li>
            <li><strong>FC25</strong><span>📱 Mobile · 💻 Desktop · 🎮 PSN · Xbox · Nintendo</span></li>
            <li><strong>FC26</strong><span>📱 Mobile · 💻 Desktop · 🎮 PSN · Xbox · Nintendo</span></li>
            <li><strong>FC27</strong><span>📱 Mobile · 💻 Desktop · 🎮 PSN · Xbox · Nintendo</span></li>
            <li><strong>FIFA Mobile</strong><span>📱 Mobile</span></li>
          </ul>
        </article>

        <article className="profile-card profile-trophies-card">
          <div className="profile-card-heading">
            <span className="profile-card-label">TROFÉUS</span>
            <Trophy size={19} />
          </div>

          <div className="profile-trophies-placeholder">
            <Trophy size={24} aria-hidden="true" />
            <strong>Em breve</strong>
            <span>As conquistas da Arena aparecerão aqui.</span>
          </div>
        </article>
      </div>
    </section>
  );
}
