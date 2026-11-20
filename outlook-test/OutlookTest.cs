using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;

internal sealed class OutlookTest : Form
{
    private readonly ListView list = new ListView { Dock = DockStyle.Fill, View = View.Details,
        FullRowSelect = true, MultiSelect = false, HideSelection = false };
    private readonly Label info = new Label { Dock = DockStyle.Bottom, Height = 45,
        Text = "Posteingang laden zeigt die neuesten 20 E-Mails aus Ihrem Standardpostfach." };
    private readonly FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true };
    private readonly Stack<MoveRecord> history = new Stack<MoveRecord>();
    private readonly Button open, move, undo;
    private dynamic outlook, session;

    private sealed class ItemKey { public string Entry, Store, Folder; }
    private sealed class MoveRecord { public ItemKey Key; public string Original; }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0) {
            var utf8 = new System.Text.UTF8Encoding(false);
            Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
            Console.SetError(new System.IO.StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
            try { RunBoardCommand(args); return 0; }
            catch (COMException ex) {
                switch(ex.ErrorCode) {
                case unchecked((int)0x80010001):
                case unchecked((int)0x8001010A): Console.Error.WriteLine("Outlook ist beschäftigt. Bitte danach erneut versuchen."); break;
                case unchecked((int)0x80010108):
                case unchecked((int)0x800706BA):
                case unchecked((int)0x80040200):
                    Console.Error.WriteLine("Die Verbindung zu Outlook wurde unterbrochen. Bitte Outlook öffnen und erneut laden."); break;
                case unchecked((int)0x8004010F): Console.Error.WriteLine("Mail oder Ordner nicht mehr vorhanden. Bitte aktualisieren."); break;
                default: Console.Error.WriteLine(ex.Message); break;
                }
                return 1;
            }
            catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OutlookTest());
        return 0;
    }

    private static void RunBoardCommand(string[] args)
    {
        var type = Type.GetTypeFromProgID("Outlook.Application");
        if (type == null) throw new InvalidOperationException("Klassisches Outlook für Windows wird benötigt.");
        bool start = args.Length == 1 && args[0] == "--connect";
        dynamic app;
        try { app = Marshal.GetActiveObject("Outlook.Application"); }
        catch (COMException) {
            if (!start && System.Diagnostics.Process.GetProcessesByName("OUTLOOK").Length==0)
                throw new InvalidOperationException("Outlook ist geschlossen. Bitte klassisches Outlook starten.");
            app = Activator.CreateInstance(type);
        }
        dynamic ns = app.GetNamespace("MAPI");
        dynamic inbox = ns.GetDefaultFolder(6);
        if (start) {
            if ((int)app.Explorers.Count==0) inbox.Display();
            return;
        }
        var serializer = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength=64*1024*1024 };
        var commands = new BoardCommands((object)ns, (object)inbox, System.Globalization.CultureInfo.CurrentCulture.TextInfo.ListSeparator, Environment.GetEnvironmentVariable("KANBAN_STATUS_PREFIX"));
        var result = commands.Execute(args, json => serializer.Deserialize<string[]>(json));
        if (result != null) Console.Write(serializer.Serialize(result));
    }

    private OutlookTest()
    {
        Text = "Mail-Board · Outlook-Verbindung testen";
        Size = new Size(850, 520);
        MinimumSize = new Size(640, 400);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(list);
        Controls.Add(actions);
        Controls.Add(info);
        list.Columns.Add("Betreff", 420);
        list.Columns.Add("Absender", 180);
        list.Columns.Add("Empfangen", 145);
        AddButton("Posteingang laden", ReadInbox);
        open = AddButton("In Outlook öffnen", () => SelectedMail().Display(false));
        move = AddButton("Verschieben …", MoveMail);
        undo = AddButton("Rückgängig (Strg+Z)", UndoMove);
        list.SelectedIndexChanged += delegate { UpdateButtons(); };
        list.DoubleClick += delegate { open.PerformClick(); };
        UpdateButtons();
    }

    private Button AddButton(string label, Action action)
    {
        var button = new Button { Text = label, AutoSize = true };
        actions.Controls.Add(button);
        button.Click += delegate {
            actions.Enabled = false;
            try { action(); }
            catch (Exception ex) {
                info.Text = ex.Message;
                MessageBox.Show(this, ex.Message, "Outlook-Test", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally { actions.Enabled = true; UpdateButtons(); }
        };
        return button;
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keys)
    {
        if (keys == (Keys.Control | Keys.Z) && undo.Enabled && actions.Enabled) {
            undo.PerformClick();
            return true;
        }
        return base.ProcessCmdKey(ref msg, keys);
    }

    private void UpdateButtons()
    {
        open.Enabled = move.Enabled = list.SelectedItems.Count == 1;
        undo.Enabled = history.Count > 0;
    }

    private void ReadInbox()
    {
        var type = Type.GetTypeFromProgID("Outlook.Application");
        if (type == null) throw new InvalidOperationException("Klassisches Outlook für Windows wird benötigt.");
        if (outlook == null) outlook = Activator.CreateInstance(type);
        session = outlook.GetNamespace("MAPI");
        dynamic inbox = session.GetDefaultFolder(6);
        dynamic items = inbox.Items;
        items.Sort("[ReceivedTime]", true);
        var rows = new List<ListViewItem>();
        for (dynamic mail = items.GetFirst(); mail != null && rows.Count < 20; mail = items.GetNext()) {
            if ((int)mail.Class != 43) continue;
            var row = new ListViewItem((string)mail.Subject ?? "");
            row.SubItems.Add((string)mail.SenderName ?? "");
            row.SubItems.Add(((DateTime)mail.ReceivedTime).ToString("g"));
            row.Tag = new ItemKey { Entry = mail.EntryID, Store = inbox.StoreID, Folder = inbox.EntryID };
            rows.Add(row);
        }
        list.Items.Clear();
        list.Items.AddRange(rows.ToArray());
        info.Text = rows.Count + " E-Mails geladen aus " + (string)inbox.FolderPath;
    }

    private dynamic Resolve(ItemKey key)
    {
        dynamic mail = session.GetItemFromID(key.Entry, key.Store);
        if ((int)mail.Class != 43 || (string)mail.Parent.EntryID != key.Folder)
            throw new InvalidOperationException("Die Mail wurde inzwischen verschoben. Bitte den Posteingang neu laden.");
        return mail;
    }

    private dynamic SelectedMail() { return Resolve((ItemKey)list.SelectedItems[0].Tag); }

    private void MoveMail()
    {
        var row = list.SelectedItems[0];
        var original = (ItemKey)row.Tag;
        dynamic target = session.PickFolder();
        if (target == null) return;
        if ((string)target.StoreID != original.Store || (int)target.DefaultItemType != 0)
            throw new InvalidOperationException("Bitte einen E-Mail-Ordner im selben Postfach wählen.");
        string destination = target.EntryID;
        if (destination == original.Folder) return;
        string question = "Diese echte Mail verschieben?\n\n" + row.Text + "\n→ " + (string)target.FolderPath;
        if (MessageBox.Show(this, question, "Verschieben bestätigen", MessageBoxButtons.YesNo,
            MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        dynamic moved = Resolve(original).Move(target);
        history.Push(new MoveRecord { Original = original.Folder, Key = new ItemKey {
            Entry = moved.EntryID, Store = original.Store, Folder = destination } });
        list.Items.Remove(row);
        info.Text = "Verschoben. Strg+Z holt die Mail zurück, solange dieses Fenster offen ist.";
    }

    private void UndoMove()
    {
        var step = history.Peek();
        dynamic target = session.GetFolderFromID(step.Original, step.Key.Store);
        Resolve(step.Key).Move(target);
        history.Pop();
        ReadInbox();
        info.Text = "Verschiebung rückgängig gemacht.";
    }
}
