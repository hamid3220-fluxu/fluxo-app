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
    ['Delete “', 'Eliminar “'], ['Permanently delete “', 'Eliminar permanentemente “'], ['Upload “', 'Carregar “'],
  ];

  const PATTERNS = [
    [/^(\d+) min ago$/, (m) => `há ${m[1]} min`],
    [/^(\d+) h ago$/, (m) => `há ${m[1]} h`],
    [/^(Claude|OpenAI) key saved\.$/, (m) => `Chave ${m[1]} guardada.`],
    [/^On for this device\. Test notification sent to (\d+) devices?\.$/, (m) => `Ativo neste dispositivo. Notificação de teste enviada para ${m[1]} dispositivo${m[1] === '1' ? '' : 's'}.`],
    [/^Due (\d{2}\/\d{2}\/\d{4}|\d{2} \w{3} \d{4})$/, (m) => `Prazo ${m[1]}`],
    [/^(\d+) minutes before$/, (m) => `${m[1]} minutos antes`],
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
