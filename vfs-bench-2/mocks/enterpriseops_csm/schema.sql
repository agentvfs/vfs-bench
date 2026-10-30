PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- Base tables first so FKs resolve in creation order
CREATE TABLE location (
  location_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(120) NOT NULL,
  plot_no VARCHAR(60),
  street VARCHAR(60),
  city TEXT NOT NULL CHECK (city IN ('new_york','london','mumbai','tokyo','sydney')),
  country TEXT NOT NULL CHECK (country IN ('usa','uk','india','japan','australia')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME
);

CREATE TABLE "user" (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name VARCHAR(60) NOT NULL,
  last_name VARCHAR(60) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(30),
  role TEXT NOT NULL CHECK (role IN ('admin','agent','manager','customer')),
  location_id INTEGER,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  FOREIGN KEY (location_id) REFERENCES location (location_id)
);

CREATE TABLE user_group (
  group_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(80) NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('support','backoffice','field','vendor')),
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME
);

CREATE TABLE account (
  account_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(120) NOT NULL UNIQUE,
  account_type TEXT NOT NULL DEFAULT 'customer' CHECK (account_type IN ('customer','partner','internal')),
  email_domain VARCHAR(80),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME
);

CREATE TABLE product (
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(120) NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('software','hardware','service')),
  product_price INTEGER,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active','retired')),
  sys_created_on DATETIME,
  sys_updated_on DATETIME
);

-- Depends on account/product/location
CREATE TABLE installed_product (
  installed_product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  location_id INTEGER,
  serial_number VARCHAR(60) NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','in_stock','repair','retired')),
  warranty_end DATE,
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  FOREIGN KEY (account_id) REFERENCES account (account_id),
  FOREIGN KEY (product_id) REFERENCES product (product_id),
  FOREIGN KEY (location_id) REFERENCES location (location_id)
);

-- Depends on account and user
CREATE TABLE contact (
  contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  portal_user_id INTEGER NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  FOREIGN KEY (account_id) REFERENCES account (account_id),
  FOREIGN KEY (portal_user_id) REFERENCES "user" (user_id)
);

CREATE TABLE contract (
  contract_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'support' CHECK (contract_type IN ('support','warranty','subscription')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','expired')),
  contract_price INTEGER,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  FOREIGN KEY (account_id) REFERENCES account (account_id)
);

CREATE TABLE entitlement (
  entitlement_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  product_id INTEGER,
  contract_id INTEGER,
  support_level TEXT NOT NULL DEFAULT 'standard' CHECK (support_level IN ('standard','premium','enterprise')),
  coverage_hours TEXT NOT NULL DEFAULT 'h8x5' CHECK (coverage_hours IN ('h8x5','h12x6','h24x7')),
  max_cases_per_month INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  FOREIGN KEY (account_id) REFERENCES account (account_id),
  FOREIGN KEY (product_id) REFERENCES product (product_id),
  FOREIGN KEY (contract_id) REFERENCES contract (contract_id)
);

CREATE TABLE sla_definition (
  sla_def_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(120) NOT NULL UNIQUE,
  metric TEXT NOT NULL CHECK (metric IN ('response','resolution')),
  target_mins INTEGER NOT NULL,
  pause_on_pending INTEGER NOT NULL DEFAULT 1 CHECK (pause_on_pending IN (0,1)),
  applies_to_priority TEXT CHECK (applies_to_priority IN ('critical','high','moderate','low')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sys_created_on DATETIME,
  sys_updated_on DATETIME
);

-- Depends on account/contact/product/installed_product/user_group/user
CREATE TABLE customer_case (
  case_id INTEGER PRIMARY KEY AUTOINCREMENT,
  number VARCHAR(40) NOT NULL UNIQUE,
  account_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  product_id INTEGER,
  installed_product_id INTEGER,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','email','phone','chat','social','alert','community')),
  priority TEXT NOT NULL DEFAULT 'moderate' CHECK (priority IN ('critical','high','moderate','low')),
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','in_progress','pending','resolved','closed','canceled')),
  short_description VARCHAR(120) NOT NULL,
  assignment_group_id INTEGER,
  assigned_to INTEGER,
  escalation INTEGER NOT NULL DEFAULT 0 CHECK (escalation IN (0,1)),
  escalation_reason TEXT CHECK (escalation_reason IN ('urgency','vip','impact','breach_risk','customer_request')),
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count BETWEEN 0 AND 32767),
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  closed_on DATETIME,
  FOREIGN KEY (account_id) REFERENCES account (account_id),
  FOREIGN KEY (contact_id) REFERENCES contact (contact_id),
  FOREIGN KEY (product_id) REFERENCES product (product_id),
  FOREIGN KEY (installed_product_id) REFERENCES installed_product (installed_product_id),
  FOREIGN KEY (assignment_group_id) REFERENCES user_group (group_id),
  FOREIGN KEY (assigned_to) REFERENCES "user" (user_id)
);

CREATE TABLE case_sla (
  case_sla_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  sla_def_id INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'in_progress' CHECK (stage IN ('in_progress','paused','completed','canceled')),
  start_time DATETIME NOT NULL,
  breach_time DATETIME,
  has_breached INTEGER NOT NULL DEFAULT 0 CHECK (has_breached IN (0,1)),
  completed_time DATETIME,
  FOREIGN KEY (case_id) REFERENCES customer_case (case_id),
  FOREIGN KEY (sla_def_id) REFERENCES sla_definition (sla_def_id)
);

CREATE TABLE interaction (
  interaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('web','email','phone','chat','social','alert','community')),
  account_id INTEGER,
  contact_id INTEGER,
  case_id INTEGER,
  interacted_user INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled','closed')),
  started_at DATETIME,
  ended_at DATETIME,
  sys_created_on DATETIME,
  FOREIGN KEY (account_id) REFERENCES account (account_id),
  FOREIGN KEY (contact_id) REFERENCES contact (contact_id),
  FOREIGN KEY (case_id) REFERENCES customer_case (case_id),
  FOREIGN KEY (interacted_user) REFERENCES "user" (user_id)
);

CREATE TABLE knowledge (
  knowledge_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_number VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('draft','published','retired')),
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','external')),
  product_id INTEGER,
  owner_id INTEGER,
  sys_created_on DATETIME,
  sys_updated_on DATETIME,
  FOREIGN KEY (product_id) REFERENCES product (product_id),
  FOREIGN KEY (owner_id) REFERENCES "user" (user_id)
);

CREATE TABLE case_knowledge (
  case_kb_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  knowledge_id INTEGER NOT NULL,
  used_as TEXT NOT NULL DEFAULT 'suggested' CHECK (used_as IN ('suggested','applied','resolution')),
  FOREIGN KEY (case_id) REFERENCES customer_case (case_id),
  FOREIGN KEY (knowledge_id) REFERENCES knowledge (knowledge_id)
);

CREATE TABLE notification (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  knowledge_id INTEGER,
  email VARCHAR(120) NOT NULL,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('report','update','alert','reminder','solution_proposal','next_steps','other')),
  status TEXT CHECK (status IN ('success','failed')),
  sys_created_on DATETIME,
  FOREIGN KEY (case_id) REFERENCES customer_case (case_id),
  FOREIGN KEY (knowledge_id) REFERENCES knowledge (knowledge_id)
);

-- Memberships last (depends on user & user_group)
CREATE TABLE user_group_member (
  member_id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  sys_created_on DATETIME,
  FOREIGN KEY (group_id) REFERENCES user_group (group_id),
  FOREIGN KEY (user_id) REFERENCES "user" (user_id)
);

COMMIT;
