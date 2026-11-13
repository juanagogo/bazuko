#include "online/Session.hpp"

#include "online/SecureStore.hpp"

#include <algorithm>
#include <utility>

namespace Bazuko::Online {

namespace {
constexpr const char* kPurpose = "Bazuko sesion v1";
constexpr long long kRefreshAhead = 300;   // renovar 5 minutos antes de que venza

void Wipe(std::string& secret) {
    std::fill(secret.begin(), secret.end(), '\0');
    secret.clear();
}
} // namespace

Session::Session(CognitoConfig config, std::filesystem::path file) : m_Config(std::move(config)), m_File(std::move(file)) {}

void Session::Begin(Step step, std::shared_ptr<HttpCall> call) {
    m_Step = step;
    m_Call = std::move(call);
    m_State = State::Working;
    m_Error = AuthError::None;
}

void Session::BeginTask(Task task, TaskStep step, std::shared_ptr<HttpCall> call) {
    m_Task = task;
    m_TaskStep = step;
    m_TaskCall = std::move(call);
    m_TaskState = TaskState::Working;
    m_TaskError = AuthError::None;
}

bool Session::CanTask() const {
    return m_State == State::SignedIn && m_TaskState != TaskState::Working && !m_Tokens.access.empty();
}

void Session::Resume() {
    if (!m_Config.Valid()) return;
    const auto refresh = LoadSecret(m_File, kPurpose);
    if (!refresh || refresh->empty()) return;
    m_Tokens = Tokens{};
    m_Tokens.refresh = *refresh;
    Begin(Step::Resume, CognitoRefresh(m_Config, m_Tokens.refresh));
}

void Session::SignIn(const std::string& name, std::string password) {
    if (m_State == State::Working) { Wipe(password); return; }
    if (!m_Config.Valid()) { m_Error = AuthError::NotConfigured; Wipe(password); return; }
    Begin(Step::SignIn, CognitoSignIn(m_Config, name, password));
    Wipe(password);
}

void Session::SignUp(const std::string& name, std::string password, const std::string& email) {
    if (m_State == State::Working) { Wipe(password); return; }
    if (!m_Config.Valid()) { m_Error = AuthError::NotConfigured; Wipe(password); return; }
    Begin(Step::SignUp, CognitoSignUp(m_Config, name, password, email));
    m_PendingName = name;
    m_PendingPassword = std::move(password);
}

void Session::SignOut() {
    if (!m_Tokens.refresh.empty() && m_Config.Valid()) CognitoRevoke(m_Config, m_Tokens.refresh);   // no se espera: el archivo se borra igual
    Drop();
}

void Session::Drop() {
    Wipe(m_Tokens.access); Wipe(m_Tokens.id); Wipe(m_Tokens.refresh);
    m_Tokens = Tokens{};
    Wipe(m_PendingPassword);
    m_PendingName.clear();
    m_SignOutOthers = false;
    m_Call.reset();
    m_Step = Step::None;
    m_State = State::SignedOut;
    m_User = UserInfo{};
    m_UserLoaded = false;
    m_Profile = OwnProfile{};
    m_ProfileLoaded = false;
    if (m_TaskState == TaskState::Working && m_Task != Task::ForgotPassword && m_Task != Task::ConfirmForgotPassword) {
        m_TaskCall.reset();   // lo que pedia sesion ya no tiene con que terminar
        m_TaskState = TaskState::Idle;
        m_Task = Task::None;
    }
    EraseSecret(m_File);
}

void Session::Adopt(const Tokens& tokens) {
    const bool sameAccount = tokens.username == m_Tokens.username;
    m_Tokens = tokens;
    m_State = State::SignedIn;
    m_Error = AuthError::None;
    SaveSecret(m_File, m_Tokens.refresh, kPurpose);
    if (!sameAccount || !m_UserLoaded) {   // al entrar: se pide el correo de la cuenta para el Perfil (sin molestar si hay otra gestion)
        m_UserLoaded = false;
        m_ProfileLoaded = false;
        if (m_TaskState != TaskState::Working) BeginTask(Task::LoadUser, TaskStep::LoadUser, CognitoGetUser(m_Config, m_Tokens.access));
    }
}

void Session::SetEmail(const std::string& email) {
    if (!CanTask()) return;
    m_TaskEmail = email;
    if (email.empty()) BeginTask(Task::SetEmail, TaskStep::SetEmail, CognitoRemoveEmail(m_Config, m_Tokens.access));
    else BeginTask(Task::SetEmail, TaskStep::SetEmail, CognitoSetEmail(m_Config, m_Tokens.access, email));
}

void Session::SendEmailCode() {
    if (!CanTask() || m_User.email.empty()) return;
    BeginTask(Task::SendEmailCode, TaskStep::SendEmailCode, CognitoSendEmailCode(m_Config, m_Tokens.access));
}

void Session::VerifyEmail(const std::string& code) {
    if (!CanTask()) return;
    BeginTask(Task::VerifyEmail, TaskStep::VerifyEmail, CognitoVerifyEmail(m_Config, m_Tokens.access, code));
}

void Session::ChangePassword(std::string oldPassword, std::string newPassword) {
    if (!CanTask()) { Wipe(oldPassword); Wipe(newPassword); return; }
    BeginTask(Task::ChangePassword, TaskStep::ChangePassword, CognitoChangePassword(m_Config, m_Tokens.access, oldPassword, newPassword));
    Wipe(oldPassword);
    m_PendingName = m_Tokens.username;
    m_PendingPassword = std::move(newPassword);   // para volver a entrar despues de cerrar los demas equipos
}

void Session::ForgotPassword(const std::string& name) {
    if (m_TaskState == TaskState::Working) return;
    if (!m_Config.Valid()) { m_Task = Task::ForgotPassword; m_TaskState = TaskState::Failed; m_TaskError = AuthError::NotConfigured; return; }
    BeginTask(Task::ForgotPassword, TaskStep::Forgot, CognitoForgotPassword(m_Config, name));
}

void Session::ConfirmForgotPassword(const std::string& name, const std::string& code, std::string newPassword) {
    if (m_TaskState == TaskState::Working || m_State == State::Working) { Wipe(newPassword); return; }
    if (!m_Config.Valid()) { Wipe(newPassword); return; }
    BeginTask(Task::ConfirmForgotPassword, TaskStep::ConfirmForgot, CognitoConfirmForgotPassword(m_Config, name, code, newPassword));
    m_PendingName = name;
    m_PendingPassword = std::move(newPassword);
}

void Session::SetAppearance(const std::string& appearanceJson) {
    if (!CanTask() || !m_Config.ApiValid()) return;
    BeginTask(Task::SaveProfile, TaskStep::SaveProfile, ApiPutMe(m_Config, m_Tokens.access, ProfileChangesJson(&appearanceJson, nullptr)));
}

void Session::SetFriendsOnly(bool friendsOnly) {
    if (!CanTask() || !m_Config.ApiValid()) return;
    BeginTask(Task::SaveProfile, TaskStep::SaveProfile, ApiPutMe(m_Config, m_Tokens.access, ProfileChangesJson(nullptr, &friendsOnly)));
}

void Session::DeleteAccount() {
    if (!CanTask()) return;
    if (m_Config.ApiValid()) BeginTask(Task::DeleteAccount, TaskStep::DeleteMe, ApiDeleteMe(m_Config, m_Tokens.access));
    else BeginTask(Task::DeleteAccount, TaskStep::DeleteUser, CognitoDeleteUser(m_Config, m_Tokens.access));
}

void Session::PreviewSignedIn(const std::string& name, const std::string& email, bool verified, const OwnProfile* profile) {
    m_Tokens = Tokens{};
    m_Tokens.username = name;
    m_State = State::SignedIn;
    m_User = UserInfo{email, verified};
    m_UserLoaded = true;
    if (profile) { m_Profile = *profile; m_ProfileLoaded = true; }
}

void Session::UpdateTask() {
    if (!m_TaskCall || !m_TaskCall->Done()) return;
    const HttpResponse response = m_TaskCall->Result();
    const TaskStep step = m_TaskStep;
    m_TaskCall.reset();
    m_TaskStep = TaskStep::None;
    const AuthError error = ParseAuthError(response);
    const auto finish = [this](AuthError failure) {
        m_TaskState = failure == AuthError::None ? TaskState::Done : TaskState::Failed;
        m_TaskError = failure;
    };
    switch (step) {
    case TaskStep::LoadUser:
        if (const auto info = ParseUserInfo(response)) { m_User = *info; m_UserLoaded = true; }
        if (m_Config.ApiValid() && m_State == State::SignedIn) { BeginTask(Task::LoadUser, TaskStep::LoadProfile, ApiGetMe(m_Config, m_Tokens.access)); break; }   // y el perfil en linea
        finish(m_UserLoaded ? AuthError::None : (error == AuthError::None ? AuthError::Unknown : error));
        break;
    case TaskStep::LoadProfile:
    case TaskStep::SaveProfile: {
        const AuthError apiError = ParseApiError(response);
        if (const auto profile = ParseOwnProfile(response)) { m_Profile = *profile; m_ProfileLoaded = true; finish(AuthError::None); }
        else finish(apiError == AuthError::None ? AuthError::Unknown : apiError);
        break;
    }
    case TaskStep::DeleteMe: {   // lo del juego ya se borro: falta la cuenta en Cognito
        const AuthError apiError = ParseApiError(response);
        if (apiError != AuthError::None) { finish(apiError); break; }
        BeginTask(Task::DeleteAccount, TaskStep::DeleteUser, CognitoDeleteUser(m_Config, m_Tokens.access));
        break;
    }
    case TaskStep::DeleteUser:
        if (error != AuthError::None) { finish(error); break; }
        Drop();   // la cuenta ya no existe: se olvida todo en este equipo (sin revocar: el token ya no sirve)
        m_Task = Task::DeleteAccount;
        finish(AuthError::None);
        break;
    case TaskStep::SetEmail:
        if (error != AuthError::None) { finish(error == AuthError::Unknown ? AuthError::EmailInvalid : error); break; }
        m_User.email = m_TaskEmail;
        m_User.emailVerified = false;
        if (m_TaskEmail.empty()) finish(AuthError::None);
        else { BeginTask(Task::SetEmail, TaskStep::SendEmailCode, CognitoSendEmailCode(m_Config, m_Tokens.access)); }   // guardado: de una vez el codigo
        break;
    case TaskStep::SendEmailCode:
        finish(error);
        break;
    case TaskStep::VerifyEmail:
        if (error == AuthError::None) m_User.emailVerified = true;
        finish(error);
        break;
    case TaskStep::ChangePassword:
        if (error != AuthError::None) {
            Wipe(m_PendingPassword);
            m_PendingName.clear();
            finish(error == AuthError::BadCredentials ? AuthError::BadCredentials : error);   // NotAuthorized aqui: la contrasena actual no es esa
            break;
        }
        BeginTask(Task::ChangePassword, TaskStep::GlobalSignOut, CognitoGlobalSignOut(m_Config, m_Tokens.access));   // los demas equipos quedan por fuera
        break;
    case TaskStep::GlobalSignOut: {   // la contrasena ya cambio: se entra de nuevo con la nueva (el token de antes quedo revocado)
        std::string password = std::move(m_PendingPassword);
        const std::string name = m_PendingName;
        m_PendingName.clear();
        Wipe(m_Tokens.access); Wipe(m_Tokens.id); Wipe(m_Tokens.refresh);
        EraseSecret(m_File);
        Begin(Step::SignIn, CognitoSignIn(m_Config, name, password));
        Wipe(password);
        finish(AuthError::None);
        break;
    }
    case TaskStep::Forgot:
        // con PreventUserExistenceErrors, una cuenta que no existe tambien responde bien; sin correo verificado responde InvalidParameter:
        // al jugador se le dice lo mismo en ambos casos, asi nadie averigua que nombres existen
        finish(error == AuthError::Unknown || error == AuthError::BadCredentials ? AuthError::None : error);
        break;
    case TaskStep::ConfirmForgot:
        if (error != AuthError::None) {
            Wipe(m_PendingPassword);
            m_PendingName.clear();
            finish(error == AuthError::Unknown || error == AuthError::BadCredentials ? AuthError::CodeWrong : error);
            break;
        }
        {
            std::string password = m_PendingPassword;   // la pendiente se queda para entrar otra vez tras cerrar los demas equipos
            m_SignOutOthers = true;
            Begin(Step::SignIn, CognitoSignIn(m_Config, m_PendingName, password));
            Wipe(password);
        }
        finish(AuthError::None);
        break;
    case TaskStep::None:
        break;
    }
}

void Session::Update(long long nowSeconds) {
    UpdateTask();
    if (m_Call && m_Call->Done()) {
        const HttpResponse response = m_Call->Result();
        const Step step = m_Step;
        m_Call.reset();
        m_Step = Step::None;
        const AuthError error = ParseAuthError(response);
        if (step == Step::SignUp) {
            if (error == AuthError::None) {   // cuenta creada: entra con ella (el disparador ya la confirmo)
                std::string password = std::move(m_PendingPassword);
                const std::string name = m_PendingName;
                m_PendingName.clear();
                Begin(Step::SignIn, CognitoSignIn(m_Config, name, password));
                Wipe(password);
                return;
            }
            Wipe(m_PendingPassword);
            m_PendingName.clear();
            m_State = State::SignedOut;
            m_Error = error;
        } else if (step == Step::SignIn) {
            const auto tokens = ParseTokens(response);
            if (tokens && m_SignOutOthers) {   // contrasena recuperada: primero se cierra la cuenta en todos los equipos y luego se entra otra vez
                m_SignOutOthers = false;
                m_Tokens = *tokens;
                Begin(Step::SignOutOthers, CognitoGlobalSignOut(m_Config, m_Tokens.access));
                return;
            }
            m_SignOutOthers = false;
            Wipe(m_PendingPassword);
            m_PendingName.clear();
            if (tokens) Adopt(*tokens);
            else { m_State = State::SignedOut; m_Error = error == AuthError::None ? AuthError::Unknown : error; }
        } else if (step == Step::SignOutOthers) {
            std::string password = std::move(m_PendingPassword);
            const std::string name = m_PendingName;
            m_PendingName.clear();
            Wipe(m_Tokens.access); Wipe(m_Tokens.id); Wipe(m_Tokens.refresh);
            Begin(Step::SignIn, CognitoSignIn(m_Config, name, password));
            Wipe(password);
        } else if (step == Step::Resume || step == Step::Refresh) {
            const auto tokens = ParseTokens(response, m_Tokens.refresh);
            if (tokens) Adopt(*tokens);
            else if (error == AuthError::Network && step == Step::Refresh) {
                m_State = State::SignedIn;   // sin internet un rato: se reintenta en 30 s
                m_RetryAt = nowSeconds + 30;
            } else if (error == AuthError::Network) {
                m_State = State::SignedOut;  // al abrir sin internet: la sesion guardada queda para la proxima vez
                m_Error = AuthError::Network;
            } else {
                Drop();                       // revocada (cambio de contrasena en otro equipo, cuenta borrada) o vencida
                m_Error = AuthError::SessionExpired;
            }
        }
        return;
    }
    if (m_State == State::SignedIn && !m_Call && m_Tokens.expires > 0 && nowSeconds > m_Tokens.expires - kRefreshAhead && nowSeconds >= m_RetryAt) {
        Begin(Step::Refresh, CognitoRefresh(m_Config, m_Tokens.refresh));
        m_State = State::SignedIn;   // se sigue usando el token actual mientras llega el nuevo
    }
}

} // namespace Bazuko::Online
