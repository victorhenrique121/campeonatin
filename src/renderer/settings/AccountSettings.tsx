import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, UserCircle } from "lucide-react";
import type { UserProfile } from "../../shared/api";
import { isValidUsername, normalizeUsername } from "../../shared/validation";
import "./account-settings.css";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = { onSaved?: (profile: UserProfile) => void };

export function AccountSettings({ onSaved }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void window.arena.getProfile().then((value) => {
      if (!active) return;
      setProfile(value);
      setDisplayName(value.displayName);
      setUsername(value.username ?? "");
      setBio(value.bio ?? "");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar seus dados.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview("");
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  useEffect(() => {
    const normalized = normalizeUsername(username);
    setError("");
    setSuccess("");
    if (!normalized) {
      setUsernameAvailable(null);
      setCheckingUsername(false);
      return;
    }
    if (!isValidUsername(normalized)) {
      setUsernameAvailable(false);
      setCheckingUsername(false);
      return;
    }
    if (profile?.username === normalized) {
      setUsernameAvailable(true);
      setCheckingUsername(false);
      return;
    }
    setCheckingUsername(true);
    setUsernameAvailable(null);
    const timer = window.setTimeout(() => {
      void window.arena.isUsernameAvailable(normalized).then(setUsernameAvailable).catch((reason) => {
        setUsernameAvailable(null);
        setError(reason instanceof Error ? reason.message : "Não foi possível verificar o username.");
      }).finally(() => setCheckingUsername(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [username, profile?.username]);

  const avatarSrc = useMemo(() => {
    if (avatarPreview) return avatarPreview;
    if (!profile?.avatarUrl) return "";
    const separator = profile.avatarUrl.includes("?") ? "&" : "?";
    return profile.avatarUrl + separator + "v=" + encodeURIComponent(profile.updatedAt);
  }, [avatarPreview, profile]);

  const handleAvatarChange = (file: File | undefined) => {
    setError("");
    setSuccess("");
    if (!file) return;
    if (!(file.type in AVATAR_TYPES)) {
      setError("O avatar deve ser JPEG, PNG ou WEBP.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("O avatar deve ter no máximo 5 MB.");
      return;
    }
    setAvatarFile(file);
  };

  const save = async () => {
    if (!profile || saving) return;
    const normalizedUsername = normalizeUsername(username);
    const normalizedBio = bio.trim();

    if (!displayName.trim()) return setError("Informe o nome de exibição.");
    if (normalizedUsername && !isValidUsername(normalizedUsername)) {
      return setError("O username deve ter de 3 a 20 caracteres: letras minúsculas, números ou _.");
    }
    if (normalizedUsername && usernameAvailable !== true) {
      return setError(checkingUsername ? "Aguarde a verificação do username." : "Escolha um username disponível.");
    }
    if (normalizedBio.length > 160) return setError("A bio deve ter no máximo 160 caracteres.");

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      let avatar: {
        bytes: Uint8Array;
        contentType: "image/jpeg" | "image/png" | "image/webp";
        extension: "jpg" | "png" | "webp";
      } | null = null;

      if (avatarFile) {
        const extension = AVATAR_TYPES[avatarFile.type as keyof typeof AVATAR_TYPES];
        avatar = {
          bytes: new Uint8Array(await avatarFile.arrayBuffer()),
          contentType: avatarFile.type as "image/jpeg" | "image/png" | "image/webp",
          extension,
        };
      }

      const updated = await window.arena.updateProfile({
        displayName: displayName.trim(),
        username: normalizedUsername || null,
        bio: normalizedBio || null,
        avatar,
      });
      setProfile(updated);
      setDisplayName(updated.displayName);
      setUsername(updated.username ?? "");
      setBio(updated.bio ?? "");
      setAvatarFile(null);
      setSuccess("Perfil atualizado com sucesso.");
      onSaved?.(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar seu perfil.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <article className="settings-card account-settings"><div className="account-settings-loading"><Loader2 className="spin" size={20} /><span>Carregando seus dados...</span></div></article>;
  }

  return (
    <article className="settings-card account-settings">
      <div className="settings-card-header">
        <div><span className="settings-card-label">CONTA</span><h2>Conta</h2><p>Atualize as informações públicas do seu perfil.</p></div>
        <UserCircle size={22} />
      </div>

      {error && <div className="account-settings-message error">{error}</div>}
      {success && <div className="account-settings-message success"><CheckCircle2 size={16} />{success}</div>}

      <div className="account-settings-avatar">
        <button type="button" className="account-avatar-preview" onClick={() => inputRef.current?.click()} aria-label="Selecionar avatar">
          {avatarSrc ? <img src={avatarSrc} alt="Prévia do avatar" /> : <span>{getInitials(displayName)}</span>}
          <span className="account-avatar-overlay"><ImagePlus size={18} /></span>
        </button>
        <div><strong>Avatar</strong><p>JPEG, PNG ou WEBP · máximo de 5 MB.</p>
          <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>Escolher imagem</button>
          <input ref={inputRef} className="account-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { handleAvatarChange(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
      </div>

      <div className="account-settings-fields">
        <label><span>Nome de exibição</span><input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} disabled={saving} placeholder="Seu nome" /></label>

        <label><span>Username</span>
          <div className="account-username-field"><span>@</span><input value={username} maxLength={20} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} disabled={saving} placeholder="seu_username" spellCheck={false} /></div>
          <small className={usernameAvailable === true ? "available" : usernameAvailable === false ? "unavailable" : ""}>
            {checkingUsername ? "Verificando disponibilidade..." : !username.trim() ? "Opcional. Use 3 a 20 caracteres." : !/^[a-z0-9_]{3,20}$/.test(username.trim()) ? "Use 3 a 20 caracteres: letras minúsculas, números ou _." : usernameAvailable === true ? "Username disponível." : "Username indisponível."}
          </small>
        </label>

        <label><span>Bio</span><textarea value={bio} maxLength={160} rows={4} onChange={(event) => setBio(event.target.value)} disabled={saving} placeholder="Conte um pouco sobre você." /><small className="account-bio-counter">{bio.length}/160</small></label>
      </div>

      <div className="account-settings-actions">
        <button type="button" className="primary-button" onClick={() => void save()} disabled={saving || checkingUsername || (Boolean(username.trim()) && usernameAvailable !== true)}>
          {saving ? <><Loader2 className="spin" size={16} />Salvando...</> : "Salvar alterações"}
        </button>
      </div>
    </article>
  );
}
