import { useEffect, useState } from "react";
import { CheckCircle2, Mail, Pencil, UserRound } from "lucide-react";
import type { UserProfile } from "../shared/api";
import "./styles/profile.css";

type ProfilePageProps = {
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

function getRoleLabel(role: UserProfile["role"]): string {
  switch (role) {
    case "admin":
      return "Administrador";
    case "player":
      return "Jogador";
    default:
      return "Visualizador";
  }
}

function formatMemberSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return String(date.getFullYear());
}

export function ProfilePage({ onEditProfile }: ProfilePageProps) {
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

            <div className="profile-detail-row">
              <span>Função</span>
              <span className="profile-role-readonly">
                {getRoleLabel(profile.role)}
                <small>Somente leitura</small>
              </span>
            </div>
          </div>
        </article>

        <article className="profile-card profile-stat-card">
          <div className="profile-card-heading">
            <span className="profile-card-label">ATIVIDADE</span>
            <Mail size={19} />
          </div>

          <div className="profile-stat-placeholder">
            <strong>Estatísticas em breve</strong>
            <span>
              As estatísticas da Arena serão adicionadas em uma próxima etapa.
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}
