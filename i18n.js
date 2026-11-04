// FLUXO interface language: Portuguese (Portugal) by default, English on request.
//
// The page is written in English. When Portuguese is selected, every visible
// text, placeholder, tooltip and dialog is translated from the dictionary
// below as it appears — including content rendered later by the app — so the
// rest of the code keeps using plain English strings. Switching language
// reloads the page. Anything inside [data-no-translate] (AI output, chat) is
// left as written.
(function () {
  const STORAGE_KEY = 'fluxo.lang';
  const read = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
  const language = read() === 'en' ? 'en' : 'pt';
  const LOCALE = language === 'pt' ? 'pt-PT' : 'en-GB';
  window.FLUXO_LANG = language;
  window.FLUXO_LOCALE = LOCALE;
  document.documentElement.lang = LOCALE;

  window.setFluxoLanguage = function (next) {
    const value = next === 'en' ? 'en' : 'pt';
    try { localStorage.setItem(STORAGE_KEY, value); } catch {}
    if (typeof window.onFluxoLanguageChange === 'function') {
      Promise.resolve(window.onFluxoLanguageChange(value)).finally(() => location.reload());
    } else {
      location.reload();
    }
  };

  // Dates and times follow the interface language unless a locale is given.
  for (const method of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']) {
    const original = Date.prototype[method];
    Date.prototype[method] = function (locales, options) {
      const useDefault = locales === undefined || (Array.isArray(locales) && !locales.length);
      return original.call(this, useDefault ? LOCALE : locales, options);
    };
  }

  if (language === 'en') { window.fluxoT = (text) => text; return; }

  // ---------------------------------------------------------------------------
  // Exact phrases
  // ---------------------------------------------------------------------------
  const PT = {
    // Navigation & shell
    'Dashboard': 'Painel', 'Calendar': 'Agenda', 'Messages': 'Mensagens', 'Contacts': 'Contactos',
    'Clients': 'Clientes', 'Tasks': 'Tarefas', 'Matters': 'Processos', 'Documents': 'Documentos',
    'Team': 'Equipa', 'Reports': 'Relatórios', 'Settings': 'Definições', 'AI Agent': 'Agente IA',
    'Main': 'Principal', 'Records': 'Registos', 'Admin': 'Administração', 'Primary navigation': 'Navegação principal',
    'Open navigation menu': 'Abrir menu de navegação', 'Close navigation menu': 'Fechar menu de navegação',
    'Sign out': 'Terminar sessão', 'Your organisation': 'A sua organização', 'Notifications': 'Notificações',
    'Mark all read': 'Marcar todas como lidas', 'No notifications yet.': 'Ainda não há notificações.',
    'just now': 'agora mesmo',
    'FLUXO — Virtual Office Assistant': 'FLUXO — Assistente de Escritório Virtual',

    // Top bar actions
    'New task': 'Nova tarefa', 'New event': 'Novo evento', 'New message': 'Nova mensagem', 'Add contact': 'Adicionar contacto',
    'Add client': 'Adicionar cliente', 'New matter': 'Novo processo', 'Upload document': 'Carregar documento',
    'Invite member': 'Convidar membro', 'Export': 'Exportar',

    // Login & account
    'Your virtual office assistant': 'O seu assistente de escritório virtual',
    "Sign in to your organisation's workspace": 'Inicie sessão no espaço de trabalho da sua organização',
    'Email': 'Email', 'Password': 'Palavra-passe', 'Forgot password?': 'Esqueceu-se da palavra-passe?', 'Sign in': 'Iniciar sessão',
    'Secure access · Data encrypted in transit': 'Acesso seguro · Dados encriptados em trânsito',
    'Set new password': 'Definir nova palavra-passe', 'Enter a new password for your FLUXO account.': 'Introduza uma nova palavra-passe para a sua conta FLUXO.',
    'New password': 'Nova palavra-passe', 'Confirm password': 'Confirmar palavra-passe', 'Minimum 8 characters': 'Mínimo 8 caracteres',
    'Repeat new password': 'Repita a nova palavra-passe', 'Set password & sign in': 'Definir palavra-passe e entrar',
    'Account': 'Conta', 'Change password': 'Alterar palavra-passe', 'Change the password you use to sign in to FLUXO.': 'Altere a palavra-passe que usa para entrar no FLUXO.',
    'Password changed.': 'Palavra-passe alterada.', 'Passwords do not match.': 'As palavras-passe não coincidem.',
    'Password must be at least 8 characters.': 'A palavra-passe deve ter pelo menos 8 caracteres.',
    'Could not change password. Please try again.': 'Não foi possível alterar a palavra-passe. Tente novamente.',
    'Could not update password. Please try again.': 'Não foi possível atualizar a palavra-passe. Tente novamente.',
    'Please enter your email address first.': 'Introduza primeiro o seu endereço de email.',
    'Please enter your email and password.': 'Introduza o seu email e palavra-passe.',
    '. Please check your inbox.': '. Verifique a sua caixa de entrada.',
    'Interface language': 'Idioma da interface', 'Language': 'Idioma',

    // Generic actions & states
    'Save': 'Guardar', 'Save changes': 'Guardar alterações', 'Saved.': 'Guardado.', 'Saving...': 'A guardar...',
    'Cancel': 'Cancelar', 'Close': 'Fechar', 'Delete': 'Eliminar', 'Edit': 'Editar', 'Send': 'Enviar', 'Sending...': 'A enviar...',
    'Sent': 'Enviado', 'Loading...': 'A carregar...', 'Try again': 'Tentar novamente', 'Yes': 'Sim', 'Preview': 'Pré-visualizar',
    'Download': 'Transferir', 'Open': 'Aberto', 'Actions': 'Ações', 'All': 'Todos', 'Generate': 'Gerar', 'Preparing...': 'A preparar...',
    'Clear search': 'Limpar pesquisa', 'Clear filters': 'Limpar filtros', 'Export CSV': 'Exportar CSV', 'Unknown error': 'Erro desconhecido',
    'unknown error': 'erro desconhecido', 'Data is unavailable.': 'Dados indisponíveis.', 'Not set': 'Não definido', 'Unassigned': 'Sem atribuição',
    'Untitled': 'Sem título', 'Unnamed': 'Sem nome', 'Unspecified': 'Não especificado', 'Connect': 'Ligar', 'Disconnect': 'Desligar',
    'Reconnect': 'Voltar a ligar', 'Connected': 'Ligado', 'Not connected': 'Não ligado', 'Configured': 'Configurado', 'Not configured': 'Não configurado',
    'Connecting...': 'A ligar...', 'Uploading...': 'A carregar...', 'Importing...': 'A importar...', 'Processing': 'Em processamento',
    'Show less': 'Mostrar menos', 'System': 'Sistema', 'Escape': 'Escape',

    // Dashboard
    "Today's plan": 'Plano de hoje', "Tomorrow's plan": 'Plano de amanhã', 'Next 7 days': 'Próximos 7 dias', 'Today': 'Hoje', 'Tomorrow': 'Amanhã',
    'Me': 'Eu', 'Whole firm': 'Todo o escritório', 'Plan period': 'Período do plano', 'Plan scope': 'Âmbito do plano',
    'Minimize plan': 'Minimizar plano', 'Show plan': 'Mostrar plano', 'Show full plan': 'Ver plano completo',
    'Preparing your plan... this takes a few seconds.': 'A preparar o seu plano... demora alguns segundos.',
    'Prepared just now': 'Preparado agora mesmo', 'The daily plan is not set up yet.': 'O plano diário ainda não está configurado.',
    'No plan for today yet. It is prepared automatically each morning, or press Generate to build it now.': 'Ainda não há plano para hoje. É preparado automaticamente todas as manhãs, ou carregue em Gerar para o criar agora.',
    'No plan for tomorrow yet. Press Generate to prepare it now.': 'Ainda não há plano para amanhã. Carregue em Gerar para o preparar agora.',
    'No plan for the next 7 days yet. Press Generate to prepare it now.': 'Ainda não há plano para os próximos 7 dias. Carregue em Gerar para o preparar agora.',
    'Tasks due today': 'Tarefas para hoje', 'Incomplete tasks due today': 'Tarefas por concluir com prazo hoje',
    'Overdue tasks': 'Tarefas em atraso', 'Incomplete past-due tasks': 'Tarefas por concluir com prazo ultrapassado',
    'Open tasks': 'Tarefas abertas', 'To do and in progress': 'Por fazer e em curso', 'Completed tasks': 'Tarefas concluídas',
    'All completed': 'Todas as concluídas', 'Unread communications': 'Comunicações por ler', 'Important communications': 'Comunicações importantes',
    'Communications today': 'Comunicações de hoje', 'Active clients': 'Clientes ativos', 'Open matters': 'Processos abertos',
    'Events today': 'Eventos de hoje', 'Upcoming events': 'Próximos eventos', 'Upcoming deadlines': 'Prazos próximos',
    'Recent communications': 'Comunicações recentes', 'Recent matters': 'Processos recentes', 'Recent documents': 'Documentos recentes',
    'Upcoming calendar events': 'Próximos eventos da agenda', 'No communications yet.': 'Ainda não há comunicações.',
    'No tasks are due today.': 'Não há tarefas com prazo hoje.', 'No overdue tasks.': 'Não há tarefas em atraso.', 'No matters yet.': 'Ainda não há processos.',
    'No upcoming calendar events.': 'Não há próximos eventos na agenda.', 'No documents yet.': 'Ainda não há documentos.',
    'Calendar setup required.': 'É necessário configurar a agenda.', 'Documents setup required.': 'É necessário configurar os documentos.',
    'Calendar unavailable.': 'Agenda indisponível.', 'Documents unavailable.': 'Documentos indisponíveis.',
    'Setup required': 'Configuração necessária',
    'Your account is not yet linked to an organisation. A system administrator must run the first-time setup in Supabase.': 'A sua conta ainda não está associada a uma organização. Um administrador do sistema tem de fazer a configuração inicial no Supabase.',

    // Tables & common fields
    'Task': 'Tarefa', 'Client': 'Cliente', 'Client *': 'Cliente *', 'Matter': 'Processo', 'Status': 'Estado', 'Priority': 'Prioridade',
    'Due': 'Prazo', 'Assigned': 'Atribuída a', 'Type': 'Tipo', 'Subject / preview': 'Assunto / pré-visualização', 'Occurred': 'Data',
    'Opened': 'Aberto em', 'Event': 'Evento', 'When': 'Quando', 'Document': 'Documento', 'Category': 'Categoria', 'Uploaded': 'Carregado',
    'Title': 'Título', 'Title *': 'Título *', 'Description': 'Descrição', 'Notes': 'Notas', 'Name': 'Nome', 'Full name': 'Nome completo',
    'Phone': 'Telefone', 'Mobile': 'Telemóvel', 'Other phone': 'Outro telefone', 'Company': 'Empresa', 'Job title': 'Cargo',
    'Address': 'Morada', 'Address line 1': 'Morada (linha 1)', 'Address line 2': 'Morada (linha 2)', 'City': 'Localidade',
    'Postal code': 'Código postal', 'Region / state': 'Distrito / região', 'Country': 'País', 'Website': 'Website', 'Tags': 'Etiquetas',
    'Source': 'Origem', 'Created': 'Criado', 'Updated': 'Atualizado', 'Date': 'Data', 'Time': 'Hora', 'Location': 'Local',
    'Reference': 'Referência', 'Reference number': 'Número de referência', 'Role': 'Função', 'ID': 'ID', 'Direction': 'Direção',
    'Context': 'Contexto', 'Participants': 'Participantes', 'Body': 'Corpo', 'Subject': 'Assunto', 'To': 'Para',
    'Email address': 'Endereço de email', 'Phone number': 'Número de telefone', 'Email / phone': 'Email / telefone',
    'Preferred language': 'Idioma preferido', 'Portuguese': 'Português', 'English': 'Inglês', 'Português': 'Português',
    'Description / notes': 'Descrição / notas', 'Internal notes': 'Notas internas', 'Legal area': 'Área jurídica',
    'Responsible lawyer': 'Advogado responsável', 'Opened date': 'Data de abertura', 'Closed date': 'Data de encerramento',
    'Document date': 'Data do documento', 'Duration': 'Duração', 'Duration (minutes, optional)': 'Duração (minutos, opcional)',
    'Start time': 'Hora de início', 'End time': 'Hora de fim', 'Timezone': 'Fuso horário', 'Time zone': 'Fuso horário',
    'Reminder': 'Lembrete', 'No reminder': 'Sem lembrete', 'At event time': 'À hora do evento', '10 minutes before': '10 minutos antes',
    '30 minutes before': '30 minutos antes', '1 hour before': '1 hora antes', '1 day before': '1 dia antes', 'minutes before': 'minutos antes',
    'All day': 'Todo o dia', '· All day': '· Todo o dia', 'Version': 'Versão', 'Current version': 'Versão atual', 'Uploaded by': 'Carregado por',
    'Original filename': 'Nome original do ficheiro', 'Type / size': 'Tipo / tamanho', 'Version history': 'Histórico de versões',

    // Status & priority values
    'To do': 'Por fazer', 'To Do': 'Por fazer', 'In progress': 'Em curso', 'In Progress': 'Em curso', 'Completed': 'Concluída',
    'Cancelled': 'Cancelado', 'On hold': 'Em pausa', 'On Hold': 'Em pausa', 'Closed': 'Encerrado', 'Active': 'Ativo', 'Inactive': 'Inativo',
    'Low': 'Baixa', 'Medium': 'Média', 'High': 'Alta', 'Urgent': 'Urgente', 'Overdue': 'Em atraso', 'Upcoming': 'Próximas',
    'Scheduled': 'Agendado', 'Unread': 'Por ler', 'Read': 'Lida', 'Replied': 'Respondida', 'Archived': 'Arquivada', 'Important': 'Importante',
    'Delivered': 'Entregue', 'Failed': 'Falhou', 'Converted': 'Convertido', 'Pending member': 'Membro pendente', 'Invitation sent': 'Convite enviado',
    'Inbound': 'Recebida', 'Outbound': 'Enviada', 'Internal': 'Interna', 'Incoming': 'Recebida', 'Outgoing': 'Efetuada',
    'Follow-up needed': 'Requer seguimento', 'Due today': 'Para hoje', 'No due date': 'Sem prazo',

    // Event & communication types
    'Meeting': 'Reunião', 'Court': 'Tribunal', 'Deadline': 'Prazo', 'Call': 'Chamada', 'Appointment': 'Marcação', 'Other': 'Outro',
    'Phone call': 'Chamada telefónica', 'Phone calls': 'Chamadas telefónicas', 'Internal note': 'Nota interna', 'Note': 'Nota',
    'Online meeting': 'Reunião online', 'WhatsApp message': 'Mensagem WhatsApp', 'Meetings': 'Reuniões', 'Calendar event': 'Evento da agenda',
    'Communication type': 'Tipo de comunicação', 'Event type': 'Tipo de evento', 'Communications': 'Comunicações',

    // Tasks
    'All tasks': 'Todas as tarefas', 'All priorities': 'Todas as prioridades',
    'Search title, client, matter, status, priority or assignee...': 'Pesquisar título, cliente, processo, estado, prioridade ou responsável...',
    'Clear task search': 'Limpar pesquisa de tarefas', 'Task details': 'Detalhes da tarefa', 'Edit task': 'Editar tarefa', 'Save task': 'Guardar tarefa',
    'Close task form': 'Fechar formulário de tarefa', 'Due date': 'Prazo', 'Due time': 'Hora limite', 'Task due date': 'Prazo da tarefa',
    'Assigned user': 'Utilizador atribuído', 'Loading tasks...': 'A carregar tarefas...', 'We could not load tasks.': 'Não foi possível carregar as tarefas.',
    'No tasks match your search or filters.': 'Nenhuma tarefa corresponde à pesquisa ou aos filtros.',
    'No tasks yet. Create your first task to get started.': 'Ainda não há tarefas. Crie a primeira tarefa para começar.',
    'Please enter a task title.': 'Introduza o título da tarefa.', 'We could not load task options.': 'Não foi possível carregar as opções da tarefa.',
    'We could not save the task. Please review the fields and try again.': 'Não foi possível guardar a tarefa. Reveja os campos e tente novamente.',
    '← Back to tasks': '← Voltar às tarefas', 'Back to tasks': 'Voltar às tarefas', 'No description': 'Sem descrição',
    'Create task': 'Criar tarefa', 'Draft': 'Minuta', 'AI draft': 'Minuta com IA',

    // AI draft from a task
    'Generate draft with AI': 'Gerar minuta com IA', 'Generate a draft': 'Gerar uma minuta', 'Generate draft': 'Gerar minuta',
    'Generate a draft document for this task with AI': 'Gerar uma minuta para esta tarefa com IA',
    'Let the AI choose from the task': 'Deixar a IA escolher com base na tarefa', 'Power of attorney (procuração)': 'Procuração',
    'Contract / agreement': 'Contrato / acordo', 'Letter to the client': 'Carta ao cliente', 'Letter to the other party': 'Carta à parte contrária',
    'Court filing': 'Peça processual', 'Legal opinion (parecer)': 'Parecer jurídico', 'Application / request': 'Requerimento / pedido',
    'Extra instructions (optional)': 'Instruções adicionais (opcional)', 'e.g. include powers to sell the family home': 'ex.: incluir poderes para vender a casa de família',
    'The draft is saved in Documents for review. Nothing is sent to anyone.': 'A minuta é guardada em Documentos para revisão. Nada é enviado a ninguém.',
    'Writing the draft... (up to a minute)': 'A redigir a minuta... (até um minuto)', 'Could not generate the draft.': 'Não foi possível gerar a minuta.',
    'The AI did not produce a document. Try adding more detail in the instructions.': 'A IA não produziu um documento. Tente acrescentar mais detalhe nas instruções.',
    'Draft ready': 'Minuta pronta', 'Saved in Documents · click to open': 'Guardada em Documentos · clique para abrir',

    // Matters
    'All matters': 'Todos os processos', 'All statuses': 'Todos os estados',
    'Search title, reference, client, legal area or status...': 'Pesquisar título, referência, cliente, área jurídica ou estado...',
    'Clear matter search': 'Limpar pesquisa de processos', 'Matter details': 'Detalhes do processo', 'Edit matter': 'Editar processo',
    'Save matter': 'Guardar processo', 'Close matter form': 'Fechar formulário de processo', 'Loading matters...': 'A carregar processos...',
    'We could not load matters.': 'Não foi possível carregar os processos.', 'No matters match your search or filters.': 'Nenhum processo corresponde à pesquisa ou aos filtros.',
    'No matters yet. Create your first matter to get started.': 'Ainda não há processos. Crie o primeiro processo para começar.',
    'Please enter a matter title.': 'Introduza o título do processo.', 'Please enter a closed date for a closed matter.': 'Introduza a data de encerramento de um processo encerrado.',
    'We could not save the matter. Please review the fields and try again.': 'Não foi possível guardar o processo. Reveja os campos e tente novamente.',
    'Please select a client.': 'Selecione um cliente.', 'Select a client': 'Selecione um cliente', 'No matter': 'Sem processo',
    'Untitled matter': 'Processo sem título', 'Open matter': 'Abrir processo', 'Update matter': 'Atualizar processo',
    'The selected matter does not belong to the selected client.': 'O processo selecionado não pertence ao cliente selecionado.',
    'No matters linked to this client.': 'Não há processos associados a este cliente.', 'We could not load matters for this client.': 'Não foi possível carregar os processos deste cliente.',
    'No reference': 'Sem referência',

    // Clients
    'All clients': 'Todos os clientes', 'Search by name, email, phone, language, status or client ID...': 'Pesquisar por nome, email, telefone, idioma, estado ou ID do cliente...',
    'Clear client search': 'Limpar pesquisa de clientes', 'New client': 'Novo cliente', 'Edit client': 'Editar cliente', 'Save client': 'Guardar cliente',
    'Close edit client form': 'Fechar formulário do cliente', 'Client status': 'Estado do cliente', 'Client details': 'Detalhes do cliente',
    'Loading clients...': 'A carregar clientes...', 'We could not load clients.': 'Não foi possível carregar os clientes.',
    'No clients match your search or filter.': 'Nenhum cliente corresponde à pesquisa ou ao filtro.',
    'No clients yet. Create your first client to get started.': 'Ainda não há clientes. Crie o primeiro cliente para começar.',
    'Please enter the client name.': 'Introduza o nome do cliente.', 'Client created successfully.': 'Cliente criado com sucesso.',
    'We could not save the client. Please try again.': 'Não foi possível guardar o cliente. Tente novamente.',
    'We could not load this client. It may be missing or you may not have access.': 'Não foi possível carregar este cliente. Pode não existir ou pode não ter acesso.',
    'Back to clients': 'Voltar aos clientes', 'Open client': 'Abrir cliente', 'No client': 'Sem cliente', 'Unnamed client': 'Cliente sem nome',
    'Client / Contact': 'Cliente / contacto', 'Client / contact': 'Cliente / contacto', 'We could not load clients and matters.': 'Não foi possível carregar os clientes e processos.',
    'Not clients': 'Não clientes', 'No linked tasks.': 'Sem tarefas associadas.', 'No linked documents.': 'Sem documentos associados.',
    'No linked communications.': 'Sem comunicações associadas.',

    // Contacts
    'All contacts': 'Todos os contactos', 'Search by name, email, phone or company...': 'Pesquisar por nome, email, telefone ou empresa...',
    'Clear contact search': 'Limpar pesquisa de contactos', 'New contact': 'Novo contacto', 'Save contact': 'Guardar contacto',
    'Close contact form': 'Fechar formulário de contacto', 'Contact': 'Contacto', 'Contact details': 'Detalhes do contacto', 'Edit contact': 'Editar contacto',
    'Loading contacts...': 'A carregar contactos...', 'No contacts match your search or filter.': 'Nenhum contacto corresponde à pesquisa ou ao filtro.',
    'No contacts yet. Add one manually or import from Google.': 'Ainda não há contactos. Adicione um manualmente ou importe do Google.',
    'Please enter the contact name.': 'Introduza o nome do contacto.', 'Please enter an email or mobile number.': 'Introduza um email ou número de telemóvel.',
    'At least one email or mobile number is required to prevent duplicates.': 'É necessário pelo menos um email ou telemóvel para evitar duplicados.',
    'A contact with this email or mobile already exists.': 'Já existe um contacto com este email ou telemóvel.',
    'We could not save this contact. Please try again.': 'Não foi possível guardar este contacto. Tente novamente.',
    'Contacts setup is required.': 'É necessário configurar os contactos.', 'Contacts setup is required or contacts could not be loaded.': 'É necessário configurar os contactos ou não foi possível carregá-los.',
    'Contact only': 'Apenas contacto', 'Create contact': 'Criar contacto', 'Update contact': 'Atualizar contacto', 'Manual': 'Manual',
    'Google Contacts': 'Google Contactos', 'Import contacts': 'Importar contactos',
    'Import is read-only. FLUXO never changes your Google contacts and never creates Clients automatically.': 'A importação é só de leitura. O FLUXO nunca altera os seus contactos Google e nunca cria Clientes automaticamente.',
    'Importing contacts from Google. Google data will not be changed.': 'A importar contactos do Google. Os dados do Google não serão alterados.',
    'Google Contacts connected. You can now import contacts.': 'Google Contactos ligado. Já pode importar contactos.',
    'Google Contacts disconnected. Imported contacts were kept.': 'Google Contactos desligado. Os contactos importados foram mantidos.',
    'Google Contacts could not be disconnected.': 'Não foi possível desligar o Google Contactos.',
    'Google Contacts import failed. Reconnect Google and try again.': 'A importação do Google Contactos falhou. Volte a ligar o Google e tente novamente.',
    'Google Contacts is not configured yet.': 'O Google Contactos ainda não está configurado.', 'Reconnect Google Contacts to continue.': 'Volte a ligar o Google Contactos para continuar.',
    'Disconnect Google Contacts? Imported FLUXO contacts will be kept.': 'Desligar o Google Contactos? Os contactos importados para o FLUXO serão mantidos.',
    'Convert this contact to a client? FLUXO will not create a second client if the email or mobile already matches one.': 'Converter este contacto em cliente? O FLUXO não cria um segundo cliente se o email ou telemóvel já corresponder a um.',
    'Delete this contact from FLUXO? The Google contact and any converted Client will be kept.': 'Eliminar este contacto do FLUXO? O contacto Google e qualquer Cliente convertido serão mantidos.',
    'The contact could not be converted. Please try again.': 'Não foi possível converter o contacto. Tente novamente.',
    'The contact could not be deleted. Please try again.': 'Não foi possível eliminar o contacto. Tente novamente.',
    'This contact was linked to the existing matching client.': 'Este contacto foi associado ao cliente correspondente já existente.',
    'Convert to client': 'Converter em cliente', 'lead, supplier, personal': 'potencial cliente, fornecedor, pessoal',
    'No address': 'Sem morada', 'No company': 'Sem empresa', 'No email': 'Sem email', 'No job title': 'Sem cargo', 'No language': 'Sem idioma',
    'No mobile': 'Sem telemóvel', 'No notes': 'Sem notas', 'No other phone': 'Sem outro telefone', 'No phone': 'Sem telefone', 'No tags': 'Sem etiquetas',
    'No website': 'Sem website', 'No content': 'Sem conteúdo', 'No additional details': 'Sem detalhes adicionais', 'Opening Google permission...': 'A abrir a permissão Google...',

    // Messages / communications
    'Search communications...': 'Pesquisar comunicações...', 'New communication': 'Nova comunicação', 'Save communication': 'Guardar comunicação',
    'Close communication form': 'Fechar formulário de comunicação', 'Communication details': 'Detalhes da comunicação', 'Edit communication': 'Editar comunicação',
    'Message details': 'Detalhes da mensagem', 'Loading communications...': 'A carregar comunicações...', 'We could not load communications.': 'Não foi possível carregar as comunicações.',
    'No communications match your search or filters.': 'Nenhuma comunicação corresponde à pesquisa ou aos filtros.',
    'No communications yet. Add the first communication.': 'Ainda não há comunicações. Adicione a primeira comunicação.',
    'All directions': 'Todas as direções', 'Mark as important': 'Marcar como importante', 'Mark important': 'Marcar como importante',
    'Remove important': 'Remover importante', 'Mark as read': 'Marcar como lida', 'Mark as unread': 'Marcar como não lida', 'Mark as replied': 'Marcar como respondida',
    'Delete communication': 'Eliminar comunicação', 'Are you sure you want to delete this communication?': 'Tem a certeza de que pretende eliminar esta comunicação?',
    'Communication removed from FLUXO.': 'Comunicação removida do FLUXO.', 'We could not save the communication.': 'Não foi possível guardar a comunicação.',
    'The communication could not be deleted. Check your organization permissions.': 'Não foi possível eliminar a comunicação. Verifique as permissões da organização.',
    'This removes the record from FLUXO. It does not delete the email from Gmail or Outlook.': 'Isto remove o registo do FLUXO. Não elimina o email do Gmail nem do Outlook.',
    'Choose a communication type and add the relevant details.': 'Escolha um tipo de comunicação e adicione os detalhes relevantes.',
    'Choose once; the form adapts to the details that matter.': 'Escolha uma vez; o formulário adapta-se aos detalhes relevantes.',
    'Link this communication to the right client and matter.': 'Associe esta comunicação ao cliente e processo certos.',
    'Compose email': 'Escrever email', 'Send email': 'Enviar email', 'Send from': 'Enviar a partir de', 'Email workflow': 'Fluxo do email',
    'Add email manually': 'Adicionar email manualmente', 'Recipient name': 'Nome do destinatário', 'Recipient address': 'Endereço do destinatário',
    'Recipient email': 'Email do destinatário',
    'Prefilled from the selected client when available; you can edit it.': 'Preenchido a partir do cliente selecionado quando disponível; pode editá-lo.', 'Sender name': 'Nome do remetente', 'Sender address': 'Endereço do remetente', 'Sender email': 'Email do remetente',
    'CC (optional)': 'CC (opcional)', 'BCC (optional)': 'BCC (opcional)', 'recipient@example.com': 'destinatario@exemplo.pt', 'email@example.com': 'email@exemplo.pt',
    'Names or email addresses, separated by commas': 'Nomes ou endereços de email, separados por vírgulas',
    'Send through a connected account; FLUXO logs the email after provider success.': 'Enviado através de uma conta ligada; o FLUXO regista o email depois de o fornecedor confirmar.',
    'Send through a connected account; FLUXO logs one record after provider success.': 'Enviado através de uma conta ligada; o FLUXO cria um registo depois de o fornecedor confirmar.',
    'Loading connected email accounts...': 'A carregar contas de email ligadas...', 'No connected email account': 'Nenhuma conta de email ligada',
    'Write the email message.': 'Escreva a mensagem do email.', 'Subject and body are required to send email.': 'O assunto e o corpo são obrigatórios para enviar o email.',
    'Success: email sent and logged as an Outbound Email.': 'Sucesso: email enviado e registado como Email Enviado.',
    'Call details': 'Detalhes da chamada', 'Call direction': 'Direção da chamada', 'Call summary / notes': 'Resumo da chamada / notas',
    'Capture the useful outcome of the call.': 'Registe o resultado útil da chamada.', 'Record the call outcome and any follow-up required.': 'Registe o resultado da chamada e qualquer seguimento necessário.',
    'Meeting details': 'Detalhes da reunião', 'Meeting notes': 'Notas da reunião', 'Capture decisions, context, and next steps.': 'Registe decisões, contexto e próximos passos.',
    'Write an internal note for your team.': 'Escreva uma nota interna para a sua equipa.', 'Add enough context for another team member.': 'Adicione contexto suficiente para outro membro da equipa.',
    'Message text / summary': 'Texto da mensagem / resumo', 'Summarize the message or paste the relevant text.': 'Resuma a mensagem ou cole o texto relevante.',
    'Notes / summary': 'Notas / resumo', 'Body / notes': 'Corpo / notas', 'Please add the relevant notes or message text.': 'Adicione as notas relevantes ou o texto da mensagem.',
    'Please enter a note.': 'Introduza uma nota.', 'Please enter a phone number.': 'Introduza um número de telefone.',
    'Please enter a valid email address.': 'Introduza um endereço de email válido.', 'Please enter a valid email.': 'Introduza um email válido.',
    'Please enter a valid recipient email address.': 'Introduza um endereço de email do destinatário válido.',
    'Please enter a valid CC email address.': 'Introduza um endereço de email CC válido.', 'Please enter a valid BCC email address.': 'Introduza um endereço de email BCC válido.',
    'Please enter valid sender and recipient email addresses.': 'Introduza endereços de email válidos para o remetente e o destinatário.',
    'Please enter a valid date and time.': 'Introduza uma data e hora válidas.', 'Send WhatsApp message': 'Enviar mensagem WhatsApp',
    'Record only the details relevant to this communication.': 'Registe apenas os detalhes relevantes para esta comunicação.',
    'Record a WhatsApp message manually. A future integration can replace this fallback.': 'Registe uma mensagem WhatsApp manualmente. Uma futura integração pode substituir esta alternativa.',
    'Only the linked client, matter, note, and importance are recorded.': 'Apenas o cliente, processo, nota e importância associados são registados.',
    'Update the relevant details without changing the original provider message.': 'Atualize os detalhes relevantes sem alterar a mensagem original do fornecedor.',
    'Keep this record compatible with Calendar without creating a duplicate event.': 'Mantenha este registo compatível com a Agenda sem criar um evento duplicado.',
    'Manual entry is a fallback for an email that already exists outside FLUXO.': 'A introdução manual é uma alternativa para um email que já existe fora do FLUXO.',
    'The provider sends the message; FLUXO creates one communication record after success.': 'O fornecedor envia a mensagem; o FLUXO cria um registo de comunicação após o sucesso.',
    'Connect Google or Microsoft in Settings before sending.': 'Ligue o Google ou a Microsoft nas Definições antes de enviar.',
    'The connected email provider did not accept the message. Check the account connection and try again.': 'O fornecedor de email ligado não aceitou a mensagem. Verifique a ligação da conta e tente novamente.',
    'Your session could not be verified. Sign in again before sending email.': 'Não foi possível verificar a sua sessão. Inicie sessão novamente antes de enviar o email.',
    'Connected email accounts could not be loaded. Check Email integrations in Settings.': 'Não foi possível carregar as contas de email ligadas. Verifique as integrações de email nas Definições.',
    'No connected email account is available. Connect Google or Microsoft in Settings, or use “Add email manually”.': 'Não há nenhuma conta de email ligada. Ligue o Google ou a Microsoft nas Definições, ou use “Adicionar email manualmente”.',
    'No connected email account was found. Connect an account or use “Add email manually”.': 'Não foi encontrada nenhuma conta de email ligada. Ligue uma conta ou use “Adicionar email manualmente”.',
    'Messages by channel': 'Mensagens por canal',

    // Calendar
    'Previous month': 'Mês anterior', 'Next month': 'Mês seguinte', 'Save event': 'Guardar evento', 'Close event form': 'Fechar formulário de evento',
    'Event details': 'Detalhes do evento', 'Edit event': 'Editar evento', 'Delete event': 'Eliminar evento', 'Add to calendar (.ics)': 'Adicionar à agenda (.ics)',
    '← Back to calendar': '← Voltar à agenda', 'External sync': 'Sincronização externa', 'Not synchronized': 'Não sincronizado',
    'Please enter an event title.': 'Introduza o título do evento.', 'Please choose an event date.': 'Escolha a data do evento.',
    'Please enter start and end times.': 'Introduza as horas de início e de fim.', 'End time must be after start time.': 'A hora de fim tem de ser posterior à hora de início.',
    'We could not load calendar events.': 'Não foi possível carregar os eventos da agenda.',
    'We could not load the calendar. Make sure the calendar migration has been applied.': 'Não foi possível carregar a agenda. Confirme que a migração da agenda foi aplicada.',
    'We could not save the event. Please review the fields and try again.': 'Não foi possível guardar o evento. Reveja os campos e tente novamente.',
    'We could not delete the event. Please try again.': 'Não foi possível eliminar o evento. Tente novamente.',
    'We could not remove the synchronized provider event. The FLUXO event was not deleted.': 'Não foi possível remover o evento sincronizado no fornecedor. O evento do FLUXO não foi eliminado.',
    'No upcoming events or task deadlines.': 'Sem próximos eventos nem prazos de tarefas.', 'Create calendar event': 'Criar evento na agenda', 'Create event on': 'Criar evento em',
    'Mon': 'Seg', 'Tue': 'Ter', 'Wed': 'Qua', 'Thu': 'Qui', 'Fri': 'Sex', 'Sat': 'Sáb', 'Sun': 'Dom',
    '(sync error)': '(erro de sincronização)', '· Sync error': '· Erro de sincronização', '· Sync retry pending': '· Nova sincronização pendente', '· Last synced': '· Última sincronização',

    // Documents
    'All categories': 'Todas as categorias', 'All file types': 'Todos os tipos de ficheiro', 'Newest uploaded': 'Mais recentes', 'Oldest': 'Mais antigos',
    'Search title, filename, description, client or matter...': 'Pesquisar título, nome do ficheiro, descrição, cliente ou processo...',
    'Clear document search': 'Limpar pesquisa de documentos', 'Close document form': 'Fechar formulário de documento', 'Document title *': 'Título do documento *',
    'File *': 'Ficheiro *', 'File': 'Ficheiro', 'Maximum 50 MB.': 'Máximo 50 MB.', 'Images': 'Imagens', 'Spreadsheets': 'Folhas de cálculo', 'Word': 'Word', 'PDF': 'PDF',
    'Document details': 'Detalhes do documento', 'Edit metadata': 'Editar metadados', 'Edit document metadata': 'Editar metadados do documento',
    'Upload new version': 'Carregar nova versão', 'Delete document permanently': 'Eliminar documento permanentemente', 'Document preview': 'Pré-visualização do documento',
    'Preview / open': 'Pré-visualizar / abrir', '← Back to documents': '← Voltar aos documentos', 'Loading documents...': 'A carregar documentos...',
    'We could not load documents.': 'Não foi possível carregar os documentos.', 'No documents match the current search or filters.': 'Nenhum documento corresponde à pesquisa ou aos filtros.',
    'No documents yet. Upload the first document.': 'Ainda não há documentos. Carregue o primeiro documento.', 'Please choose a file.': 'Escolha um ficheiro.',
    'Please enter a document title.': 'Introduza o título do documento.', 'This file is larger than the 50 MB MVP limit.': 'Este ficheiro excede o limite de 50 MB.',
    'The file could not be uploaded. Check permissions, size, and connection.': 'Não foi possível carregar o ficheiro. Verifique as permissões, o tamanho e a ligação.',
    'The document could not be downloaded. Please try again.': 'Não foi possível transferir o documento. Tente novamente.',
    'A secure preview link could not be created. Please try again.': 'Não foi possível criar uma ligação segura de pré-visualização. Tente novamente.',
    'This format does not have a secure browser preview. Download it to open in the appropriate application.': 'Este formato não tem pré-visualização segura no navegador. Transfira-o para o abrir na aplicação adequada.',
    'Version history could not be loaded.': 'Não foi possível carregar o histórico de versões.', 'We could not update the document metadata.': 'Não foi possível atualizar os metadados do documento.',
    'Contract': 'Contrato', 'Court document': 'Documento judicial', 'Identification': 'Identificação', 'Correspondence': 'Correspondência', 'Invoice': 'Fatura',
    'Evidence': 'Prova', 'Power of attorney': 'Procuração', 'Legal opinion': 'Parecer jurídico', 'Application': 'Requerimento', 'Certificate': 'Certidão',
    'contract, signed, urgent': 'contrato, assinado, urgente', 'Could not read the selected file': 'Não foi possível ler o ficheiro selecionado',

    // Team
    'Invite team member': 'Convidar membro da equipa', 'Send invitation': 'Enviar convite', 'Organization members, roles, and pending invitations.': 'Membros da organização, funções e convites pendentes.',
    'Joined / invited': 'Entrada / convite', 'Lawyer': 'Advogado', 'Staff': 'Colaborador', 'Administrator': 'Administrador', 'Employee': 'Colaborador',
    'Loading team...': 'A carregar equipa...', 'No team members found.': 'Nenhum membro da equipa encontrado.', 'No active team members yet.': 'Ainda não há membros ativos.',
    'Team setup is required or the team could not be loaded.': 'É necessário configurar a equipa ou não foi possível carregá-la.',
    'Only an organization admin can change member status.': 'Apenas um administrador da organização pode alterar o estado dos membros.',
    'The invitation could not be sent. Confirm the Edge Function and email provider are configured.': 'Não foi possível enviar o convite. Confirme que a Edge Function e o fornecedor de email estão configurados.',
    'Activate': 'Ativar', 'Deactivate': 'Desativar', 'Unnamed user': 'Utilizador sem nome',

    // Reports
    'New inquiries (this month)': 'Novos pedidos (este mês)', 'Avg first response': 'Tempo médio de 1.ª resposta', 'Time to first reply': 'Tempo até à primeira resposta',
    'Requires attention': 'Requer atenção', 'Matters by legal area': 'Processos por área jurídica', 'Open tasks by employee': 'Tarefas abertas por colaborador',
    'Completed this month': 'Concluídas este mês', 'vs last month': 'vs mês anterior', 'Open tasks · Coming soon': 'Tarefas abertas · Brevemente',
    'Coming soon: task data is not available': 'Brevemente: dados de tarefas indisponíveis',

    // Settings
    'Organisation': 'Organização', 'Firm name': 'Nome do escritório', 'Logo': 'Logótipo', 'e.g. Monteiro & Associados': 'ex.: Monteiro & Associados',
    "Your firm's name and logo, shown in the sidebar and login screen. Only an admin can change this.": 'O nome e o logótipo do escritório, mostrados na barra lateral e no ecrã de entrada. Apenas um administrador os pode alterar.',
    'Reset to FLUXO default': 'Repor predefinição FLUXO', 'Reset to the default FLUXO branding.': 'Repor a imagem predefinida do FLUXO.',
    'Could not reset branding.': 'Não foi possível repor a imagem.', 'Could not save organisation settings.': 'Não foi possível guardar as definições da organização.',
    'WhatsApp Business': 'WhatsApp Business', 'WhatsApp Business App': 'Aplicação WhatsApp Business', 'Connect WhatsApp': 'Ligar WhatsApp', 'Reconnect WhatsApp': 'Voltar a ligar WhatsApp',
    'Connect your existing WhatsApp Business App number without removing it from the mobile app. Messages will appear in Communications and will match Contacts and Clients by phone number.': 'Ligue o número da sua aplicação WhatsApp Business sem o remover do telemóvel. As mensagens aparecem em Comunicações e são associadas a Contactos e Clientes pelo número de telefone.',
    'Complete the WhatsApp database setup first.': 'Conclua primeiro a configuração da base de dados do WhatsApp.',
    'WhatsApp connected successfully. Your mobile app remains active.': 'WhatsApp ligado com sucesso. A aplicação no telemóvel continua ativa.',
    'WhatsApp connection is unavailable': 'A ligação WhatsApp está indisponível', 'WhatsApp connection was cancelled.': 'A ligação WhatsApp foi cancelada.',
    'The WhatsApp connection could not be completed.': 'Não foi possível concluir a ligação WhatsApp.', 'Connected — mobile app remains active': 'Ligado — a aplicação no telemóvel continua ativa',
    'Opening the secure Meta connection...': 'A abrir a ligação segura à Meta...', 'Meta connection could not be loaded': 'Não foi possível carregar a ligação à Meta',
    'Meta connection could not be opened.': 'Não foi possível abrir a ligação à Meta.', 'Meta connection timed out': 'A ligação à Meta expirou',
    'Meta did not return the WhatsApp Business Account. Please try again.': 'A Meta não devolveu a conta WhatsApp Business. Tente novamente.',
    'AI settings': 'Definições de IA', 'Claude and OpenAI API keys for the AI Agent': 'Chaves API Claude e OpenAI para o Agente IA',
    "Provide API keys so the AI Agent can read your firm's data and propose actions. Claude is used first; OpenAI is used only as a fallback if Claude is unavailable. The Agent never sends or creates anything without an operator approving it in the AI Agent page.": 'Indique as chaves API para que o Agente IA possa ler os dados do escritório e propor ações. O Claude é usado primeiro; o OpenAI só é usado como alternativa se o Claude não estiver disponível. O Agente nunca envia nem cria nada sem aprovação de um operador na página do Agente IA.',
    'Anthropic (Claude) — primary': 'Anthropic (Claude) — principal', 'OpenAI — fallback': 'OpenAI — alternativa', 'Save key': 'Guardar chave',
    'Using the FLUXO platform key': 'A usar a chave da plataforma FLUXO', 'Error saving key': 'Erro ao guardar a chave', 'Could not save the key.': 'Não foi possível guardar a chave.',
    'Email integrations': 'Integrações de email', 'Google / Gmail': 'Google / Gmail', 'Microsoft 365': 'Microsoft 365', 'Connect Google': 'Ligar Google', 'Connect Microsoft': 'Ligar Microsoft',
    'Connect a personal work mailbox. Email is sent directly through FLUXO → Supabase Edge Function → Google/Microsoft API. OAuth tokens remain server-side and are never displayed here.': 'Ligue uma caixa de correio de trabalho pessoal. O email é enviado diretamente através de FLUXO → Supabase Edge Function → API Google/Microsoft. Os tokens OAuth ficam no servidor e nunca são mostrados aqui.',
    'Google connected': 'Google ligado', 'Microsoft connected': 'Microsoft ligado', 'Email connection error': 'Erro na ligação de email', 'Email connection unavailable': 'Ligação de email indisponível',
    'Check the Email integration setup.': 'Verifique a configuração da integração de email.', 'The email account could not be disconnected.': 'Não foi possível desligar a conta de email.',
    'Calendar integrations': 'Integrações de agenda', 'Google Calendar': 'Google Calendar', 'Microsoft Outlook': 'Microsoft Outlook', 'Microsoft Calendar': 'Microsoft Calendar',
    'Connect Google Calendar': 'Ligar Google Calendar', 'Connect Microsoft Calendar': 'Ligar Microsoft Calendar',
    'Connect an external calendar to synchronize FLUXO events and use provider notifications on your devices.': 'Ligue uma agenda externa para sincronizar os eventos do FLUXO e receber notificações do fornecedor nos seus dispositivos.',
    'Calendar disconnected.': 'Agenda desligada.', 'We could not disconnect the calendar. Please try again.': 'Não foi possível desligar a agenda. Tente novamente.',
    'Calendar is not configured yet. Add the server-side OAuth configuration described in supabase/calendar-integrations.md.': 'A agenda ainda não está configurada. Adicione a configuração OAuth no servidor descrita em supabase/calendar-integrations.md.',
    'Loading status...': 'A carregar estado...', 'Loading connection...': 'A carregar ligação...', 'Connection error · reconnect required': 'Erro de ligação · é necessário voltar a ligar',
    'Connection expired': 'Ligação expirada', 'Connection needs attention': 'A ligação requer atenção', 'Permission revoked': 'Permissão revogada',
    'Connected — read-only access': 'Ligado — acesso só de leitura', 'Not connected · provider configuration is not available yet': 'Não ligado · a configuração do fornecedor ainda não está disponível',
    'Reconnect to finish setup.': 'Volte a ligar para concluir a configuração.', 'Provider credentials are not configured yet.': 'As credenciais do fornecedor ainda não estão configuradas.',
    'Preparing secure connection...': 'A preparar ligação segura...', 'Preparing secure authorization...': 'A preparar autorização segura...',
    'Finishing the secure connection...': 'A concluir a ligação segura...', 'The secure connection could not be started.': 'Não foi possível iniciar a ligação segura.',
    'The Google connection could not be started.': 'Não foi possível iniciar a ligação ao Google.',
    'Notifications & daily plan': 'Notificações e plano diário',
    'Your personal settings. Notifications always appear under the bell. Mobile push works now (turn it on once per phone or computer). Email and WhatsApp delivery are coming next — your choices for those are saved and will apply as soon as they are switched on.': 'As suas definições pessoais. As notificações aparecem sempre no sino. As notificações push já funcionam (ative-as uma vez em cada telemóvel ou computador). O envio por email e WhatsApp vem a seguir — as suas escolhas ficam guardadas e serão aplicadas assim que forem ativados.',
    'Send to': 'Enviar para', 'In FLUXO (bell)': 'No FLUXO (sino)', 'Mobile / browser push': 'Push no telemóvel / navegador', 'WhatsApp': 'WhatsApp',
    'WhatsApp number, e.g. +351912345678': 'Número WhatsApp, ex.: +351912345678', 'Notify me about': 'Notificar-me sobre',
    'Meeting & deadline reminders': 'Lembretes de reuniões e prazos', 'Tasks due soon': 'Tarefas com prazo próximo', 'Tasks assigned to me': 'Tarefas atribuídas a mim',
    'New emails & WhatsApp messages': 'Novos emails e mensagens WhatsApp', 'AI suggestions waiting for approval': 'Sugestões da IA a aguardar aprovação',
    'Daily plan': 'Plano diário', 'Prepare my plan every morning': 'Preparar o meu plano todas as manhãs', 'At': 'Às', 'Europe/Lisbon': 'Europe/Lisbon',
    'Enter your WhatsApp number in international format, e.g. +351912345678.': 'Introduza o seu número WhatsApp em formato internacional, ex.: +351912345678.',
    'Checking this device...': 'A verificar este dispositivo...', 'Turn on for this device': 'Ativar neste dispositivo', 'Turn off on this device': 'Desativar neste dispositivo',
    'Send test': 'Enviar teste', 'On for this device.': 'Ativo neste dispositivo.', 'Not on for this device yet.': 'Ainda não está ativo neste dispositivo.',
    'This browser does not support push notifications.': 'Este navegador não suporta notificações push.',
    'This browser could not start the notification service.': 'Este navegador não conseguiu iniciar o serviço de notificações.',
    "Notifications are blocked for FLUXO in this browser. Allow them in the browser's site settings, then reload.": 'As notificações do FLUXO estão bloqueadas neste navegador. Permita-as nas definições do site e recarregue a página.',
    'On iPhone or iPad: tap the Share button, choose "Add to Home Screen", then open FLUXO from the home screen and turn notifications on there.': 'No iPhone ou iPad: toque em Partilhar, escolha "Adicionar ao ecrã principal", abra o FLUXO a partir do ecrã principal e ative aí as notificações.',
    'On for this device, but the test could not be delivered. Try turning it off and on again.': 'Ativo neste dispositivo, mas não foi possível entregar o teste. Experimente desativar e voltar a ativar.',
    'Data retention': 'Retenção de dados', 'Retain records for (years)': 'Conservar registos durante (anos)', 'e.g. 7': 'ex.: 7',
    "This records your policy for reference; FLUXO doesn't automatically delete anything yet.": 'Isto regista a sua política para referência; o FLUXO ainda não elimina nada automaticamente.',
    'Audit logs': 'Registos de auditoria',
    'The last 100 changes across tasks, matters, clients, contacts, calendar, communications and documents. Visible to admins only.': 'As últimas 100 alterações em tarefas, processos, clientes, contactos, agenda, comunicações e documentos. Visível apenas para administradores.',
    "No audit log entries yet, or you don't have access to view them.": 'Ainda não há registos de auditoria, ou não tem acesso para os ver.',
    'Not available yet': 'Ainda não disponível', 'Open Settings': 'Abrir Definições',

    // AI Agent
    'Ask the agent to look things up or draft an action. Nothing is sent, created or changed until you approve it below.': 'Peça ao agente para procurar informação ou preparar uma ação. Nada é enviado, criado ou alterado sem a sua aprovação abaixo.',
    'Ask the agent...': 'Pergunte ao agente...', 'Pending approval': 'A aguardar aprovação', 'No actions waiting for approval.': 'Não há ações a aguardar aprovação.',
    'Thinking...': 'A pensar...', 'The agent could not respond.': 'O agente não conseguiu responder.', 'This action could not be processed.': 'Não foi possível processar esta ação.',
    'Conversation not found': 'Conversa não encontrada',
    'Ask about tasks, matters, contacts, calendar, or draft an email or WhatsApp message. Every send or create is queued for your approval.': 'Pergunte sobre tarefas, processos, contactos ou agenda, ou peça um email ou mensagem WhatsApp. Cada envio ou criação fica a aguardar a sua aprovação.',
    'Send email': 'Enviar email', 'Create task': 'Criar tarefa', 'Open matter': 'Abrir processo',

    // Session / errors
    'Your session has expired. Please sign in again.': 'A sua sessão expirou. Inicie sessão novamente.',
    'Your session has expired. Please sign in again and retry.': 'A sua sessão expirou. Inicie sessão novamente e repita.',
    'We could not find your organization.': 'Não foi possível encontrar a sua organização.',
    'We could not find your organization. Please try again.': 'Não foi possível encontrar a sua organização. Tente novamente.',
    'We could not save the changes. Please try again.': 'Não foi possível guardar as alterações. Tente novamente.',
    'Only admins can see the firm-wide plan': 'Apenas os administradores podem ver o plano de todo o escritório',

    // Firms (platform owner) & invitations
    'Firms': 'Escritórios', 'FLUXO owner': 'Proprietário FLUXO', 'Add a firm': 'Adicionar escritório',
    'Each law firm gets its own organisation. Its clients, matters, documents and messages are completely separate from every other firm. Only you see this section.': 'Cada escritório tem a sua própria organização. Os seus clientes, processos, documentos e mensagens ficam totalmente separados dos de qualquer outro escritório. Só o proprietário vê esta secção.',
    'Administrator name': 'Nome do administrador', 'Administrator email': 'Email do administrador', 'Create firm': 'Criar escritório',
    'New link': 'Nova ligação', 'Create a new sign-in link for this administrator': 'Criar uma nova ligação de acesso para este administrador',
    'Send this link to the administrator (WhatsApp or email). Opening it signs them in and asks them to choose a password. It works once and expires after about an hour; if it expires, use "New link".': 'Envie esta ligação ao administrador (WhatsApp ou email). Ao abri-la, entra no FLUXO e é-lhe pedido que escolha uma palavra-passe. Funciona uma vez e expira ao fim de cerca de uma hora; se expirar, use "Nova ligação".',
    'Copy link': 'Copiar ligação', 'Copied': 'Copiado', 'Could not create the firm.': 'Não foi possível criar o escritório.',
    'Only FLUXO platform owners can manage firms': 'Apenas os proprietários da plataforma FLUXO podem gerir escritórios',
    "Enter the firm's name": 'Introduza o nome do escritório', "Enter the administrator's name": 'Introduza o nome do administrador',
    'Enter a valid email address': 'Introduza um endereço de email válido', 'Administrator not found': 'Administrador não encontrado',
    'This email already has a FLUXO account in another firm': 'Este email já tem uma conta FLUXO noutro escritório',
    'Welcome to FLUXO': 'Bem-vindo ao FLUXO',
    'Choose a password for your account. You will use it with your email to sign in from now on.': 'Escolha uma palavra-passe para a sua conta. Passará a usá-la com o seu email para entrar.',

    // Added 28 October: portal, billing, deadlines, parties, AI tools
    'Client Portal': 'Portal do Cliente',
    'My Matters': 'Os meus processos',
    'AI Assistant': 'Assistente IA',
    'Loading…': 'A carregar…',
    'Loading messages…': 'A carregar mensagens…',
    'Could not load matters.': 'Não foi possível carregar os processos.',
    'No matters found.': 'Nenhum processo encontrado.',
    'No documents found.': 'Nenhum documento encontrado.',
    'Could not get download link.': 'Não foi possível obter a ligação de transferência.',
    'No billing found.': 'Sem faturação.',
    'Total Fees': 'Total de honorários',
    'Paid': 'Pago',
    'Balance Due': 'Saldo em dívida',
    'No billing entries found.': 'Sem registos de faturação.',
    'Could not load messages.': 'Não foi possível carregar as mensagens.',
    'No messages yet. Send a message to your lawyer below.': 'Ainda não há mensagens. Envie uma mensagem ao seu advogado abaixo.',
    'No messages yet with this client.': 'Ainda não há mensagens com este cliente.',
    'You': 'Você',
    'none on file': 'nenhum registado',
    'Please provide an email address.': 'Indique um endereço de email.',
    'Portal Messages': 'Mensagens do portal',
    'NEW': 'NOVO',
    'Write a message to the client…': 'Escreva uma mensagem ao cliente…',
    'Write a message to your lawyer…': 'Escreva uma mensagem ao seu advogado…',
    'Invite to Portal': 'Convidar para o portal',
    'Invite this client to the Client Portal': 'Convidar este cliente para o Portal do Cliente',
    'Portal access created. Send this link to the client (WhatsApp or email); it is already copied. It works once and expires after about an hour. Invite again for a fresh link.': 'Acesso ao portal criado. Envie esta ligação ao cliente (WhatsApp ou email); já foi copiada. Funciona uma vez e expira ao fim de cerca de uma hora. Convide novamente para obter uma nova ligação.',
    'Ask questions about your matters. AI cannot give legal advice — always consult your lawyer for important decisions.': 'Faça perguntas sobre os seus processos. A IA não presta aconselhamento jurídico — consulte sempre o seu advogado para decisões importantes.',
    'Ask a question about your case to get started.': 'Faça uma pergunta sobre o seu processo para começar.',
    'Ask': 'Perguntar',
    'e.g. What is the current status of my matter? What documents are pending?': 'ex.: Qual é o estado atual do meu processo? Que documentos estão pendentes?',
    'Sorry, I could not process your question. Please try again.': 'Lamento, não foi possível processar a sua pergunta. Tente novamente.',
    'Not available in the client portal': 'Indisponível no portal do cliente',
    'Client not found': 'Cliente não encontrado',
    'Only firm staff can invite clients to the portal': 'Apenas a equipa do escritório pode convidar clientes para o portal',
    'This email already has another FLUXO account': 'Este email já tem outra conta FLUXO',
    'Could not create the portal account': 'Não foi possível criar a conta do portal',
    'Not authenticated': 'Sessão não iniciada',
    'Loading contact...': 'A carregar contacto...',
    'We could not load this contact.': 'Não foi possível carregar este contacto.',
    'Back to contacts': 'Voltar aos contactos',
    '← Back to contacts': '← Voltar aos contactos',
    'Delete contact': 'Eliminar contacto',
    'Contact information': 'Informação de contacto',
    'Loading client details...': 'A carregar detalhes do cliente...',
    '← Back to clients': '← Voltar aos clientes',
    'Client information': 'Informação do cliente',
    'Client ID': 'ID do cliente',
    'View all matters': 'Ver todos os processos',
    'View all tasks': 'Ver todas as tarefas',
    'View all communications': 'Ver todas as comunicações',
    'View calendar': 'Ver agenda',
    'Loading calendar events...': 'A carregar eventos da agenda...',
    'View all documents': 'Ver todos os documentos',
    'Loading matter details...': 'A carregar detalhes do processo...',
    'We could not load this matter. It may be missing or you may not have access.': 'Não foi possível carregar este processo. Pode não existir ou pode não ter acesso.',
    'Back to matters': 'Voltar aos processos',
    '← Back to matters': '← Voltar aos processos',
    'Loading event...': 'A carregar evento...',
    'We could not load this event. It may be missing or you may not have access.': 'Não foi possível carregar este evento. Pode não existir ou pode não ter acesso.',
    'Back to calendar': 'Voltar à agenda',
    'Loading task details...': 'A carregar detalhes da tarefa...',
    'We could not load this task. It may be missing or you may not have access.': 'Não foi possível carregar esta tarefa. Pode não existir ou pode não ter acesso.',
    'Loading communication...': 'A carregar comunicação...',
    'We could not load this communication.': 'Não foi possível carregar esta comunicação.',
    'Back to messages': 'Voltar às mensagens',
    'Sender': 'Remetente',
    'Recipient': 'Destinatário',
    'Archive': 'Arquivar',
    '← Back to communications': '← Voltar às comunicações',
    'Loading document...': 'A carregar documento...',
    'We could not load this document. It may be missing or you may not have access.': 'Não foi possível carregar este documento. Pode não existir ou pode não ter acesso.',
    'Back to documents': 'Voltar aos documentos',
    '— current': '— atual',
    'Unknown type': 'Tipo desconhecido',
    'Summary': 'Resumo',
    'No data yet.': 'Ainda sem dados.',
    'We could not load documents. The Documents migration may still need to be applied.': 'Não foi possível carregar os documentos. Pode ser necessário aplicar a migração de Documentos.',
    'The document record could not be saved; the uploaded file was cleaned up.': 'Não foi possível guardar o registo do documento; o ficheiro carregado foi removido.',
    'Version metadata could not be saved; the upload was rolled back.': 'Não foi possível guardar os metadados da versão; o carregamento foi anulado.',
    'Version metadata could not be saved; the uploaded file was cleaned up.': 'Não foi possível guardar os metadados da versão; o ficheiro carregado foi removido.',
    'The new version could not be uploaded.': 'Não foi possível carregar a nova versão.',
    'The current version could not be updated; the new version was rolled back.': 'Não foi possível atualizar a versão atual; a nova versão foi anulada.',
    'Stored files could not be removed, so the document record was kept.': 'Não foi possível remover os ficheiros guardados, por isso o registo do documento foi mantido.',
    'Files were removed, but metadata deletion failed. Contact an administrator to complete cleanup.': 'Os ficheiros foram removidos, mas a eliminação dos metadados falhou. Contacte um administrador para concluir a limpeza.',
    '⚙️ Setup required': '⚙️ Configuração necessária',
    'AI Summary': 'Resumo IA',
    'Generate Summary': 'Gerar resumo',
    'Generating summary…': 'A gerar resumo…',
    'Click "Generate Summary" to get an AI-powered overview of this matter.': 'Clique em "Gerar resumo" para obter uma visão geral deste processo feita pela IA.',
    'Parties': 'Partes',
    'Add party': 'Adicionar parte',
    'Edit party': 'Editar parte',
    'Loading parties...': 'A carregar partes...',
    'Plaintiff': 'Autor',
    'Defendant': 'Réu',
    'Witness': 'Testemunha',
    'Counterparty': 'Contraparte',
    'Third party': 'Terceiro',
    'Individual': 'Particular',
    'Could not load parties.': 'Não foi possível carregar as partes.',
    'No parties added yet.': 'Ainda não foram adicionadas partes.',
    'Name *': 'Nome *',
    'Role *': 'Papel *',
    'Full name or company name': 'Nome completo ou denominação social',
    'Optional notes': 'Notas opcionais',
    'Name is required.': 'O nome é obrigatório.',
    'Could not save party.': 'Não foi possível guardar a parte.',
    'Remove this party from the matter?': 'Remover esta parte do processo?',
    'Unknown matter': 'Processo desconhecido',
    'other client': 'outro cliente',
    'in this client\'s matters': 'nos processos deste cliente',
    'Conflict of interest warning': 'Aviso de conflito de interesses',
    'The following parties appear in matters of': 'As seguintes partes aparecem em processos de',
    'other clients': 'outros clientes',
    '. Review before proceeding.': '. Reveja antes de continuar.',
    'One or more parties in this matter also appear in': 'Uma ou mais partes deste processo aparecem também em',
    'other matters': 'outros processos',
    'Procedural Deadlines': 'Prazos processuais',
    'Add deadline': 'Adicionar prazo',
    'Edit deadline': 'Editar prazo',
    'Loading deadlines...': 'A carregar prazos...',
    'Add procedural deadline': 'Adicionar prazo processual',
    'Procedural': 'Processual',
    'Statutory': 'Legal',
    'Court order': 'Despacho judicial',
    'Filing': 'Entrega de peça',
    'Response': 'Resposta',
    'Hearing': 'Audiência',
    'Appeal': 'Recurso',
    'Pending': 'Pendente',
    'Confirmed': 'Confirmado',
    'Missed': 'Perdido',
    'Waived': 'Dispensado',
    'Could not load deadlines.': 'Não foi possível carregar os prazos.',
    'No deadlines added yet.': 'Ainda não foram adicionados prazos.',
    'Confirm': 'Confirmar',
    'Done': 'Concluído',
    'e.g. File defence brief': 'ex.: Apresentar contestação',
    'Due date *': 'Prazo *',
    'Please enter a title.': 'Introduza um título.',
    'Please choose a due date.': 'Escolha um prazo.',
    'Could not save. Please try again.': 'Não foi possível guardar. Tente novamente.',
    'Delete this deadline?': 'Eliminar este prazo?',
    'Billing': 'Faturação',
    'Statement': 'Extrato',
    'Loading billing...': 'A carregar faturação...',
    'Fees': 'Honorários',
    'Expenses': 'Despesas',
    'Payments': 'Pagamentos',
    'Add fee': 'Adicionar honorário',
    'Edit fee': 'Editar honorário',
    'Add fee arrangement': 'Adicionar acordo de honorários',
    'Fee Arrangements': 'Acordos de honorários',
    'Fixed fee': 'Honorário fixo',
    'Hourly': 'À hora',
    'Contingency %': 'Quota litis %',
    'Retainer': 'Avença',
    'Hybrid': 'Misto',
    'Court fees': 'Custas judiciais',
    'Travel': 'Deslocações',
    'Translation': 'Tradução',
    'Expert / opinion': 'Perito / parecer',
    'Postage': 'Portes de correio',
    'Copies': 'Cópias',
    'Notary': 'Notário',
    'Registration': 'Registos',
    'Bail / bond': 'Caução',
    'Bank transfer': 'Transferência bancária',
    'Cash': 'Numerário',
    'Check': 'Cheque',
    'MBway': 'MB WAY',
    'Advance': 'Provisão',
    'Payment': 'Pagamento',
    'Refund': 'Reembolso',
    'Fees agreed': 'Honorários acordados',
    'Time worked': 'Tempo trabalhado',
    'Balance due': 'Saldo em dívida',
    'Date agreed': 'Data do acordo',
    'Amount': 'Montante',
    'Total fees': 'Total de honorários',
    'Time Entries': 'Registos de tempo',
    'Duration / Rate': 'Duração / tarifa',
    'Total time': 'Tempo total',
    'Total expenses': 'Total de despesas',
    'Payments Received': 'Pagamentos recebidos',
    'Method / Reference': 'Método / referência',
    'Billing Statement': 'Extrato de faturação',
    '🖨 Print / Save PDF': '🖨 Imprimir / guardar PDF',
    'Total charged': 'Total cobrado',
    'For office use — Invoice reference': 'Uso interno — referência da fatura',
    'Invoice number': 'Número da fatura',
    'Invoice date': 'Data da fatura',
    'Invoiced by': 'Faturado por',
    'Invoiced amount': 'Montante faturado',
    'No fee arrangements recorded yet.': 'Ainda não há acordos de honorários.',
    'No time entries yet.': 'Ainda não há registos de tempo.',
    'Log time': 'Registar tempo',
    'No expenses recorded yet.': 'Ainda não há despesas registadas.',
    'Add expense': 'Adicionar despesa',
    'Edit expense': 'Editar despesa',
    'No payments recorded yet.': 'Ainda não há pagamentos registados.',
    'Record payment': 'Registar pagamento',
    'Edit payment': 'Editar pagamento',
    'Type *': 'Tipo *',
    'Amount (€) *': 'Montante (€) *',
    'Hourly rate (€/h) — for hourly/hybrid': 'Tarifa horária (€/h) — para à hora/misto',
    'Contingency % — for contingency': 'Quota litis % — para quota litis',
    'Agreed date': 'Data do acordo',
    'Amount is required.': 'O montante é obrigatório.',
    'Delete this fee arrangement?': 'Eliminar este acordo de honorários?',
    'Edit time entry': 'Editar registo de tempo',
    'Date *': 'Data *',
    'Description *': 'Descrição *',
    'e.g. Client meeting, reviewed draft': 'ex.: Reunião com cliente, revisão de minuta',
    'Duration (minutes) *': 'Duração (minutos) *',
    'Hourly rate (€/h) *': 'Tarifa horária (€/h) *',
    'Description, duration and rate are required.': 'A descrição, a duração e a tarifa são obrigatórias.',
    'Delete this time entry?': 'Eliminar este registo de tempo?',
    'Category *': 'Categoria *',
    'Description and amount are required.': 'A descrição e o montante são obrigatórios.',
    'Delete this expense?': 'Eliminar esta despesa?',
    'Method': 'Método',
    'Bank ref / receipt no.': 'Ref. bancária / n.º de recibo',
    'Delete this payment?': 'Eliminar este pagamento?',
    'AI Tools': 'Ferramentas IA',
    'Smart Search': 'Pesquisa inteligente',
    'Search': 'Pesquisar',
    'Searching…': 'A pesquisar…',
    'Search across all matters, clients, and documents using natural language.': 'Pesquise em todos os processos, clientes e documentos em linguagem natural.',
    'No relevant results found.': 'Nenhum resultado relevante encontrado.',
    'Legal Document Drafter': 'Redator de documentos jurídicos',
    'Draft legal documents using AI. Always review before use.': 'Redija documentos jurídicos com IA. Reveja sempre antes de usar.',
    'Document type': 'Tipo de documento',
    'Select type...': 'Selecione o tipo...',
    'Non-Disclosure Agreement (NDA)': 'Acordo de confidencialidade (NDA)',
    'Power of Attorney': 'Procuração',
    'Service Agreement': 'Contrato de prestação de serviços',
    'Lease Agreement': 'Contrato de arrendamento',
    'Employment Contract': 'Contrato de trabalho',
    'Settlement Agreement': 'Acordo de transação',
    'Demand Letter': 'Carta de interpelação',
    'Client Engagement Letter': 'Carta de compromisso com o cliente',
    'Motion / Petition': 'Requerimento / petição',
    'Legal Opinion Letter': 'Parecer jurídico',
    'Link to matter (optional)': 'Associar a processo (opcional)',
    'Additional instructions (optional)': 'Instruções adicionais (opcional)',
    'Generate Draft': 'Gerar minuta',
    'e.g. Party names, specific clauses, jurisdiction, language...': 'ex.: nomes das partes, cláusulas específicas, jurisdição, idioma...',
    'Please select a document type.': 'Selecione um tipo de documento.',
    'Drafting document…': 'A redigir documento…',
    'Copy': 'Copiar',
    'Copied!': 'Copiado!',
    '⚠️ AI-generated draft — review carefully before use. This is not legal advice.': '⚠️ Minuta gerada por IA — reveja com atenção antes de usar. Não constitui aconselhamento jurídico.',
    'Thinking…': 'A pensar…',
    'AI error': 'Erro da IA',
    'Powered by Groq — AI assists you, you stay in control.': 'Com tecnologia Groq — a IA ajuda, a decisão é sua.',

    'Confidential — for internal use only': 'Confidencial — apenas para uso interno', 'Could not save.': 'Não foi possível guardar.',

    'Invitation created. Send this link to your colleague (WhatsApp or email); it is already copied. It works once and expires after about an hour. Invite again for a fresh link.': 'Convite criado. Envie esta ligação ao seu colega (WhatsApp ou email); já foi copiada. Funciona uma vez e expira ao fim de cerca de uma hora. Convide novamente para obter uma nova ligação.',
    'Invalid invitation': 'Convite inválido', 'Admin access required': 'É necessário acesso de administrador',

    'Invitation created': 'Convite criado', 'Client Portal access created': 'Acesso ao Portal do Cliente criado',
    'Send this link to the client. When they open it, they choose their own password; after that they sign in any time at fluxo.mentedev.pt with their email and password, without the link.': 'Envie esta ligação ao cliente. Ao abri-la, escolhe a sua própria palavra-passe; a partir daí entra quando quiser em fluxo.mentedev.pt com o seu email e palavra-passe, sem precisar da ligação.',
    'Send this link to your colleague. When they open it, they choose their own password; after that they sign in any time with their email and password, without the link.': 'Envie esta ligação ao seu colega. Ao abri-la, escolhe a sua própria palavra-passe; a partir daí entra quando quiser com o seu email e palavra-passe, sem precisar da ligação.',
    'Send via WhatsApp': 'Enviar por WhatsApp', 'Send by email': 'Enviar por email',
    'The link works once and expires after about an hour. If it expires, invite again to get a new link.': 'A ligação funciona uma vez e expira ao fim de cerca de uma hora. Se expirar, convide novamente para obter uma nova ligação.',
    'You have been invited to FLUXO. Open this link to choose your password and sign in:': 'Foi convidado para o FLUXO. Abra esta ligação para escolher a sua palavra-passe e entrar:',

    // Notifications created by FLUXO
    'AI suggestion waiting for approval': 'Sugestão da IA a aguardar aprovação',
    'FLUXO notifications are on': 'As notificações do FLUXO estão ativas',
    'This device will now receive reminders, new tasks and messages.': 'Este dispositivo vai passar a receber lembretes, novas tarefas e mensagens.',
  };

  // Strings that start with a fixed English part followed by data.
  const PREFIXES = [
    ['Could not prepare the plan: ', 'Não foi possível preparar o plano: '],
    ['Could not turn notifications on: ', 'Não foi possível ativar as notificações: '],
    ['Test failed: ', 'O teste falhou: '], ['Login failed: ', 'Falha ao iniciar sessão: '],
    ['Profile loading failed: ', 'Falha ao carregar o perfil: '], ['Sign out failed: ', 'Falha ao terminar sessão: '],
    ['Could not send reset email: ', 'Não foi possível enviar o email de recuperação: '], ['Provider error: ', 'Erro do fornecedor: '],
    ['We could not load your profile: ', 'Não foi possível carregar o seu perfil: '], ['We could not load the dashboard (', 'Não foi possível carregar o painel ('],
    ['Import complete: ', 'Importação concluída: '], ['Last import: ', 'Última importação: '], ['Password reset email sent to ', 'Email de recuperação enviado para '],
    ['Prepared ', 'Preparado '], ['New task: ', 'Nova tarefa: '], ['Reminder: ', 'Lembrete: '], ['Due soon: ', 'Prazo a aproximar-se: '],
    ['Your plan for ', 'O seu plano para '], ['Email from ', 'Email de '], ['WhatsApp from ', 'WhatsApp de '], ['Starts at ', 'Começa às '],
    ['Due at ', 'Prazo às '], ['Whole firm · ', 'Todo o escritório · '], ['Create event on ', 'Criar evento em '],
    ['Delete “', 'Eliminar “'], ['Lawyer: ', 'Advogado: '], ['Deadline: ', 'Prazo: '], ['Overdue: ', 'Em atraso: '], ['Opened: ', 'Aberto em: '],
    ['Could not send message: ', 'Não foi possível enviar a mensagem: '], ['Billing Statement — ', 'Extrato de faturação — '],
    ['Matter: ', 'Processo: '], ['Client: ', 'Cliente: '], ['Generated: ', 'Gerado em: '], ['Task: ', 'Tarefa: '],
    ['· Ref: ', '· Ref.: '], ['· Confirmed by ', '· Confirmado por '], ['Error: ', 'Erro: '], ['Members: ', 'Membros: '], ['Created ', 'Criado em '],
    ['Firm created: ', 'Escritório criado: '], ['New sign-in link for ', 'Nova ligação de acesso para '], ['Permanently delete “', 'Eliminar permanentemente “'], ['Upload “', 'Carregar “'],
  ];

  const PATTERNS = [
    [/^(\d+) min ago$/, (m) => `há ${m[1]} min`],
    [/^(\d+) h ago$/, (m) => `há ${m[1]} h`],
    [/^(Claude|OpenAI) key saved\.$/, (m) => `Chave ${m[1]} guardada.`],
    [/^On for this device\. Test notification sent to (\d+) devices?\.$/, (m) => `Ativo neste dispositivo. Notificação de teste enviada para ${m[1]} dispositivo${m[1] === '1' ? '' : 's'}.`],
    [/^Due (\d{2}\/\d{2}\/\d{4}|\d{2} \w{3} \d{4})$/, (m) => `Prazo ${m[1]}`],
    [/^(\d+) minutes before$/, (m) => `${m[1]} minutos antes`],
    [/^(\d+) days? overdue$/, (m) => `${m[1]} dia${m[1] === '1' ? '' : 's'} em atraso`],
    [/^Invite "(.*)" to the Client Portal\. Enter their email address \(leave blank to use: (.*)\):$/, (m) => `Convidar "${m[1]}" para o Portal do Cliente. Introduza o endereço de email (deixe em branco para usar: ${translate(m[2])}):`],
    [/^Create Client Portal access for: (\S+) This creates a portal login for this client\. Continue\?$/, (m) => `Criar acesso ao Portal do Cliente para: ${m[1]} Isto cria um acesso ao portal para este cliente. Continuar?`],
  ];

  function translate(raw) {
    if (raw == null) return raw;
    const text = String(raw);
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) return text;
    const keep = (value) => text.replace(text.trim(), value); // keep surrounding whitespace
    if (Object.prototype.hasOwnProperty.call(PT, trimmed)) return keep(PT[trimmed]);
    for (const [pattern, build] of PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) return keep(build(match));
    }
    for (const [english, portuguese] of PREFIXES) {
      if (trimmed.startsWith(english)) return keep(portuguese + translate(trimmed.slice(english.length)));
    }
    if (trimmed.includes(' · ')) {
      const parts = trimmed.split(' · ');
      const translated = parts.map((part) => translate(part));
      if (translated.some((part, index) => part !== parts[index])) return keep(translated.join(' · '));
    }
    return text;
  }
  window.fluxoT = translate;

  const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
  const skip = (element) => !element || element.closest('script,style,[data-no-translate],[contenteditable="true"]');
  const skipText = (element) => skip(element) || element.closest('textarea');

  function translateElementAttributes(element) {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) {
        const next = translate(value);
        if (next !== value) element.setAttribute(name, next);
      }
    }
  }

  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (!skipText(root.parentElement)) {
        const next = translate(root.nodeValue);
        if (next !== root.nodeValue) root.nodeValue = next;
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || skip(root)) return;
    translateElementAttributes(root);
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach((element) => { if (!skip(element)) translateElementAttributes(element); });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (skipText(node.parentElement)) continue;
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }

  // Dialogs raised by the app.
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = (message) => nativeAlert(translate(message));
  window.confirm = (message) => nativeConfirm(translate(message));
  const nativePrompt = window.prompt.bind(window);
  window.prompt = (message, value) => nativePrompt(translate(message), value);

  function start() {
    document.title = translate(document.title);
    translateTree(document.body);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTree(mutation.target);
        else if (mutation.type === 'attributes') { if (!skip(mutation.target)) translateElementAttributes(mutation.target); }
        else mutation.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
